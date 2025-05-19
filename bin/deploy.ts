#!/usr/bin/env node
import { spawn } from 'child_process';
import { AwsAuthenticator } from '../src/utils/aws-auth';
import { getConfig } from '../src/utils/config';

/**
 * CDKをデプロイする
 */
async function deploy() {
  try {
    // 環境設定を取得
    const config = getConfig();
    console.log(`アプリケーション ${config.appName} のデプロイを開始します...`);
    
    // AWS認証
    const authenticator = new AwsAuthenticator(
      config.awsAccountId,
      config.awsRegion,
      config.cdkDeployerRoleName
    );
    
    await authenticator.authenticate();
    
    // CDKをブートストラップ
    console.log('CDKブートストラップを実行中...');
    await runCommand('npx', [
      'cdk',
      'bootstrap',
      `aws://${config.awsAccountId}/${config.awsRegion}`,
      '--require-approval=never',
    ]);
    
    // CDKをデプロイ
    console.log('CDKデプロイを実行中...');
    await runCommand('npx', [
      'cdk',
      'deploy',
      `${config.appName}-stack`,
      '--require-approval=never',
    ]);
    
    console.log('デプロイが完了しました！');
  } catch (error) {
    console.error('デプロイ中にエラーが発生しました:', error);
    process.exit(1);
  }
}

/**
 * コマンドを実行する
 */
function runCommand(command: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const process = spawn(command, args, { stdio: 'inherit' });
    
    process.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`コマンド ${command} ${args.join(' ')} が終了コード ${code} で失敗しました`));
      }
    });
    
    process.on('error', (err) => {
      reject(err);
    });
  });
}

// スクリプトを実行
deploy();
