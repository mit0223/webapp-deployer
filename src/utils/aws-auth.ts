import { spawnSync } from "child_process";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { homedir } from "os";
import { join, dirname } from "path";
import * as readline from "readline";

/**
 * AWS認証情報を取得・管理するクラス
 */
export class AwsAuthenticator {
  private readonly accountId: string;
  private readonly region: string;
  private readonly roleName: string;

  constructor(accountId: string, region: string, roleName: string) {
    this.accountId = accountId;
    this.region = region;
    this.roleName = roleName;
  }

  /**
   * OTPコードを入力して一時的なクレデンシャルを取得し、aws-cliの設定を行う
   */
  public async authenticate(): Promise<void> {
    console.log("AWS認証を開始します...");

    try {
      // AWSの初期設定を行う
      this.setupInitialAwsConfig();

      // MFAデバイスのARNを環境変数から取得
      const mfaArn = process.env.MFA_DEVICE_ARN;
      if (!mfaArn) {
        throw new Error(
          "環境変数 MFA_DEVICE_ARN が設定されていません。GitHub SecretsまたはCodespacesの環境変数に設定してください。"
        );
      }

      // OTPコードを入力
      const otpCode = await this.promptForOtp();

      // 一時的なセッショントークンを取得
      const credentials = this.assumeRole(mfaArn, otpCode);

      // 認証情報を設定
      this.setupAwsCredentials(credentials);

      console.log("AWS認証に成功しました。");
    } catch (error) {
      console.error("AWS認証に失敗しました:", error);
      throw error;
    }
  }

  /**
   * AWS CLIの初期設定
   * クレデンシャル取得のための最小限の設定を行う
   */
  private setupInitialAwsConfig(): void {
    console.log("AWS CLIの初期設定を行います...");

    const awsConfigDir = join(homedir(), ".aws");
    const configFile = join(awsConfigDir, "config");
    const credentialsFile = join(awsConfigDir, "credentials");

    // AWS設定ディレクトリが存在しない場合は作成
    if (!existsSync(awsConfigDir)) {
      mkdirSync(awsConfigDir, { recursive: true });
    }

    // AWS認証情報用の新しいIAMアクセスキーを作成し、.envに追加することを推奨
    console.log("IAMユーザー認証情報を確認しています...");

    // クレデンシャルファイルを作成（既存ファイルを上書き）
    // 注意: 本番環境では適切なIAMユーザーの認証情報を使用すること
    // このダミーキーはロールの引き受け時に検証されません
    const credentialsContent = `[default]
aws_access_key_id = AKIAIOSFODNN7EXAMPLE
aws_secret_access_key = wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY
region = ${this.region}
`;

    writeFileSync(credentialsFile, credentialsContent);
    console.log(`AWS認証情報ファイルを設定しました: ${credentialsFile}`);

    // AWS設定ファイルを作成
    if (!existsSync(configFile)) {
      writeFileSync(
        configFile,
        `[default]
region = ${this.region}
output = json
`
      );
      console.log(`AWS設定ファイルを作成しました: ${configFile}`);
    }

    // 環境変数にも設定
    process.env.AWS_DEFAULT_REGION = this.region;

    // AWS CLI 設定が機能するか確認
    console.log("AWS設定をテストしています...");
    const testResult = spawnSync("aws", ["sts", "get-caller-identity"], {
      stdio: ["ignore", "pipe", "pipe"],
    });

    if (testResult.status !== 0) {
      console.warn(
        "初期AWS設定テストに失敗しました - ロール引き受け時に処理されます"
      );
      if (testResult.stderr) {
        console.warn(testResult.stderr.toString());
      }
    } else {
      console.log("AWS設定テスト成功 - 現在の認証情報:");
      console.log(testResult.stdout.toString());
    }
  }

  /**
   * OTPコードをユーザーに入力してもらう
   */
  private promptForOtp(): Promise<string> {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    return new Promise((resolve) => {
      rl.question("MFAデバイスのOTPコードを入力してください: ", (otpCode) => {
        rl.close();
        resolve(otpCode.trim());
      });
    });
  }

  /**
   * IAMロールを引き受ける
   */
  private assumeRole(mfaArn: string, otpCode: string): any {
    const roleArn = `arn:aws:iam::${this.accountId}:role/${this.roleName}`;
    const sessionName = `cdk-deploy-session-${Date.now()}`;

    console.log(`ロール ${roleArn} を引き受けます...`);
    console.log(`MFAデバイス: ${mfaArn}`);

    // 以下の戦略を試してみる：
    // 1. 直接 get-session-token を使用する
    // 2. それが失敗した場合、IAMユーザーの認証情報を環境変数から設定
    // 3. 通常のassume-roleを試みる

    try {
      // 1. STS get-session-tokenを試す
      console.log(
        "AWS STS GetSessionToken を使用して一時的な認証情報を取得します..."
      );

      const getSessionResult = spawnSync(
        "aws",
        [
          "sts",
          "get-session-token",
          "--serial-number",
          mfaArn,
          "--token-code",
          otpCode,
          "--duration-seconds",
          "3600",
          "--output",
          "json",
        ],
        {
          env: { ...process.env },
          stdio: ["inherit", "pipe", "pipe"],
        }
      );

      if (getSessionResult.status === 0) {
        try {
          // セッショントークンの取得に成功
          const sessionCredentials = JSON.parse(
            getSessionResult.stdout.toString()
          );

          // 2. 環境変数に一時的なセッション認証情報を設定
          process.env.AWS_ACCESS_KEY_ID =
            sessionCredentials.Credentials.AccessKeyId;
          process.env.AWS_SECRET_ACCESS_KEY =
            sessionCredentials.Credentials.SecretAccessKey;
          process.env.AWS_SESSION_TOKEN =
            sessionCredentials.Credentials.SessionToken;
          process.env.AWS_DEFAULT_REGION = this.region;

          console.log("一時的なセッション認証情報を取得しました");

          // 認証情報ファイルにも書き込む
          const awsConfigDir = join(homedir(), ".aws");
          const credentialsFile = join(awsConfigDir, "credentials");

          const credentialsContent = `[default]
aws_access_key_id = ${sessionCredentials.Credentials.AccessKeyId}
aws_secret_access_key = ${sessionCredentials.Credentials.SecretAccessKey}
aws_session_token = ${sessionCredentials.Credentials.SessionToken}
region = ${this.region}
`;

          writeFileSync(credentialsFile, credentialsContent);
          console.log("認証情報ファイルを更新しました");

          // 2b. セッション認証情報でロールを引き受ける (MFAは不要)
          const assumeResult = spawnSync(
            "aws",
            [
              "sts",
              "assume-role",
              "--role-arn",
              roleArn,
              "--role-session-name",
              sessionName,
              "--output",
              "json",
            ],
            {
              env: { ...process.env },
              stdio: ["inherit", "pipe", "pipe"],
            }
          );

          if (assumeResult.status === 0) {
            console.log("セッショントークンでロールの引き受けに成功しました");
            return JSON.parse(assumeResult.stdout.toString());
          } else {
            console.warn(
              "セッショントークンでのロール引き受けに失敗しました、通常のロール引き受けを試みます"
            );
            if (assumeResult.stderr) {
              console.warn(assumeResult.stderr.toString());
            }
          }
        } catch (error) {
          console.error(
            "セッション認証情報の処理中にエラーが発生しました:",
            error
          );
        }
      } else {
        console.warn("セッショントークンの取得に失敗しました:");
        if (getSessionResult.stderr) {
          console.warn(getSessionResult.stderr.toString());
        }
      }
    } catch (error) {
      console.warn("セッショントークン取得中にエラーが発生しました:", error);
    }

    // 3. AWS IAMユーザー認証情報で直接ロールを引き受ける
    console.log("IAMユーザー認証情報を使用して直接ロールを引き受けます...");

    // IAMユーザー認証情報を環境変数から確認（推奨方法）
    if (!process.env.AWS_ACCESS_KEY_ID || !process.env.AWS_SECRET_ACCESS_KEY) {
      console.log(
        "環境変数からIAMユーザー認証情報が見つかりません。IAMユーザー認証情報を設定してください。"
      );
    }

    // 実行するコマンドをログ出力（機密情報を除く）
    console.log(
      `実行コマンド: aws sts assume-role --role-arn ${roleArn} --role-session-name ${sessionName} --output json`
    );

    // 直接ロールを引き受けを試みる
    const result = spawnSync(
      "aws",
      [
        "sts",
        "assume-role",
        "--role-arn",
        roleArn,
        "--role-session-name",
        sessionName,
        "--output",
        "json",
      ],
      {
        env: { ...process.env },
        stdio: ["inherit", "pipe", "pipe"],
      }
    );

    // AWS CLIのバージョンとステータスを表示
    this.runAwsCliVersion();

    if (result.status !== 0) {
      console.error("ロールの引き受けに失敗しました:");
      if (result.stderr) {
        console.error(result.stderr.toString());
      }
      if (result.stdout) {
        console.error("出力:", result.stdout.toString());
      }

      throw new Error(
        "ロールの引き受けに失敗しました。AWS CLIの設定を確認してください。"
      );
    }

    try {
      console.log("ロールの引き受けに成功しました");
      return JSON.parse(result.stdout.toString());
    } catch (error) {
      console.error(
        "レスポンスの解析に失敗しました:",
        result.stdout.toString()
      );
      throw new Error("レスポンスの解析に失敗しました");
    }
  }

  /**
   * AWS CLIのバージョンを実行して確認
   */
  private runAwsCliVersion(): void {
    try {
      console.log("AWS CLIのバージョン確認:");
      const versionResult = spawnSync("aws", ["--version"], {
        stdio: "inherit",
      });

      if (versionResult.status !== 0) {
        console.warn("AWS CLIのバージョン確認に失敗しました");
      }
    } catch (error) {
      console.warn("AWS CLIのバージョン確認中にエラーが発生しました:", error);
    }
  }

  /**
   * AWS認証情報を設定
   */
  private setupAwsCredentials(credentials: any): void {
    // 環境変数に認証情報を設定
    process.env.AWS_ACCESS_KEY_ID = credentials.Credentials.AccessKeyId;
    process.env.AWS_SECRET_ACCESS_KEY = credentials.Credentials.SecretAccessKey;
    process.env.AWS_SESSION_TOKEN = credentials.Credentials.SessionToken;
    process.env.AWS_DEFAULT_REGION = this.region;

    // AWS認証情報ファイルにも書き込む
    const awsConfigDir = join(homedir(), ".aws");
    const credentialsFile = join(awsConfigDir, "credentials");

    try {
      const credentialsContent = `[default]
aws_access_key_id = ${credentials.Credentials.AccessKeyId}
aws_secret_access_key = ${credentials.Credentials.SecretAccessKey}
aws_session_token = ${credentials.Credentials.SessionToken}
region = ${this.region}
`;

      writeFileSync(credentialsFile, credentialsContent);
      console.log(`AWS認証情報ファイルを更新しました: ${credentialsFile}`);
    } catch (error) {
      console.warn(
        "AWS認証情報ファイルの更新に失敗しましたが、環境変数は設定されています:",
        error
      );
    }

    console.log("一時的な認証情報を環境変数とAWS設定ファイルに設定しました");

    // 有効期限を表示
    const expirationDate = new Date(credentials.Credentials.Expiration);
    console.log(`この認証情報の有効期限: ${expirationDate.toLocaleString()}`);
  }
}
