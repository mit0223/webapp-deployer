#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import 'source-map-support/register';
import { WebAppStack } from '../lib/webapp-stack';
import { getConfig } from '../src/utils/config';

async function main() {
  try {
    // 環境設定を取得
    const config = getConfig();
    
    // CDKアプリケーションの作成
    const app = new cdk.App();
    
    // スタックを作成
    new WebAppStack(app, `${config.appName}-stack`, config, {
      env: {
        account: config.awsAccountId,
        region: config.awsRegion,
      },
      description: `${config.appName} ECS Deployment with CDK`,
      tags: {
        Environment: 'Production',
        Application: config.appName,
      },
    });
    
    // アプリケーションを合成
    app.synth();
    
    console.log('CDKアプリケーションを正常に合成しました');
  } catch (error) {
    console.error('CDKアプリケーションの合成中にエラーが発生しました:', error);
    process.exit(1);
  }
}

main();
