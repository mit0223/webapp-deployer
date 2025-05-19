import { spawnSync } from 'child_process';
import { readFileSync, writeFileSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import * as readline from 'readline';

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
    console.log('AWS認証を開始します...');
    
    try {
      // MFAデバイスのARNを取得
      const mfaArn = await this.getMfaDeviceArn();
      if (!mfaArn) {
        throw new Error('MFAデバイスが設定されていません。AWS IAMコンソールでMFAデバイスを設定してください。');
      }
      
      // OTPコードを入力
      const otpCode = await this.promptForOtp();
      
      // 一時的なセッショントークンを取得
      const credentials = this.assumeRole(mfaArn, otpCode);
      
      // 認証情報を設定
      this.setupAwsCredentials(credentials);
      
      console.log('AWS認証に成功しました。');
    } catch (error) {
      console.error('AWS認証に失敗しました:', error);
      throw error;
    }
  }

  /**
   * ユーザーのMFAデバイスARNを取得
   */
  private async getMfaDeviceArn(): Promise<string | null> {
    const result = spawnSync('aws', ['iam', 'list-mfa-devices', '--query', 'MFADevices[0].SerialNumber', '--output', 'text']);
    
    if (result.status !== 0) {
      console.error('MFAデバイスの取得に失敗しました:', result.stderr.toString());
      throw new Error('MFAデバイスの取得に失敗しました');
    }
    
    const mfaArn = result.stdout.toString().trim();
    return mfaArn === 'None' ? null : mfaArn;
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
      rl.question('MFAデバイスのOTPコードを入力してください: ', (otpCode) => {
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
    
    const result = spawnSync('aws', [
      'sts',
      'assume-role',
      '--role-arn', roleArn,
      '--role-session-name', sessionName,
      '--serial-number', mfaArn,
      '--token-code', otpCode,
      '--duration-seconds', '3600',
      '--output', 'json',
    ]);
    
    if (result.status !== 0) {
      console.error('ロールの引き受けに失敗しました:', result.stderr.toString());
      throw new Error('ロールの引き受けに失敗しました');
    }
    
    try {
      return JSON.parse(result.stdout.toString());
    } catch (error) {
      console.error('レスポンスの解析に失敗しました:', result.stdout.toString());
      throw new Error('レスポンスの解析に失敗しました');
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
    
    console.log('一時的な認証情報を環境変数に設定しました');
    
    // 有効期限を表示
    const expirationDate = new Date(credentials.Credentials.Expiration);
    console.log(`この認証情報の有効期限: ${expirationDate.toLocaleString()}`);
  }
}
