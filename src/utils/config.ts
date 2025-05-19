import * as dotenv from 'dotenv';
import { join } from 'path';

// .envファイルがあれば読み込む
dotenv.config({ path: join(__dirname, '../../.env') });

export interface EnvironmentConfig {
  // AWS アカウントとリージョン
  awsAccountId: string;
  awsRegion: string;
  
  // IAMロール
  cdkDeployerRoleName: string;
  
  // アプリケーション設定
  appName: string;
  containerPort: number;
  containerImage: string;
  desiredCount: number;
  cpu: number;
  memory: number;
  
  // VPC設定
  vpcCidr: string;
  publicSubnetMask: number;
  privateSubnetMask: number;
  natGateways: number;
  
  // ALB設定
  albPort: number;
  healthCheckPath: string;
}

/**
 * 環境変数を読み込み、デフォルト値を設定し、妥当性をチェックする
 */
export function getConfig(): EnvironmentConfig {
  // 環境変数を取得し、必要に応じてデフォルト値を設定
  const config: EnvironmentConfig = {
    // AWS アカウントとリージョン（必須）
    awsAccountId: getRequiredEnv('AWS_ACCOUNT_ID'),
    awsRegion: getEnvWithDefault('AWS_REGION', 'ap-northeast-1'),
    
    // IAMロール（必須）
    cdkDeployerRoleName: getEnvWithDefault('CDK_DEPLOYER_ROLE_NAME', 'CdkDeployer'),
    
    // アプリケーション設定
    appName: getEnvWithDefault('APP_NAME', 'webapp'),
    containerPort: parseInt(getEnvWithDefault('CONTAINER_PORT', '8080')),
    containerImage: getRequiredEnv('CONTAINER_IMAGE'),
    desiredCount: parseInt(getEnvWithDefault('DESIRED_COUNT', '2')),
    cpu: parseInt(getEnvWithDefault('CPU', '256')),
    memory: parseInt(getEnvWithDefault('MEMORY', '512')),
    
    // VPC設定
    vpcCidr: getEnvWithDefault('VPC_CIDR', '10.0.0.0/16'),
    publicSubnetMask: parseInt(getEnvWithDefault('PUBLIC_SUBNET_MASK', '24')),
    privateSubnetMask: parseInt(getEnvWithDefault('PRIVATE_SUBNET_MASK', '24')),
    natGateways: parseInt(getEnvWithDefault('NAT_GATEWAYS', '1')),
    
    // ALB設定
    albPort: parseInt(getEnvWithDefault('ALB_PORT', '80')),
    healthCheckPath: getEnvWithDefault('HEALTH_CHECK_PATH', '/health'),
  };
  
  // 環境変数の妥当性チェック
  validateConfig(config);
  
  return config;
}

/**
 * 必須の環境変数を取得する。存在しない場合はエラーをスローする。
 */
function getRequiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`必須の環境変数 ${name} が設定されていません。`);
  }
  return value;
}

/**
 * 環境変数を取得し、存在しない場合はデフォルト値を返す
 */
function getEnvWithDefault(name: string, defaultValue: string): string {
  return process.env[name] || defaultValue;
}

/**
 * 設定値の妥当性をチェックする
 */
function validateConfig(config: EnvironmentConfig): void {
  // AWS アカウントIDの形式チェック
  if (!/^\d{12}$/.test(config.awsAccountId)) {
    throw new Error('AWS_ACCOUNT_ID は12桁の数字である必要があります');
  }
  
  // AWS リージョンの形式チェック
  if (!/^[a-z]{2}-[a-z]+-\d$/.test(config.awsRegion)) {
    throw new Error('AWS_REGION の形式が正しくありません（例: ap-northeast-1）');
  }
  
  // コンテナポートの範囲チェック
  if (config.containerPort < 1 || config.containerPort > 65535) {
    throw new Error('CONTAINER_PORT は1〜65535の範囲内である必要があります');
  }
  
  // コンテナイメージの形式チェック
  if (!config.containerImage.includes('/')) {
    throw new Error('CONTAINER_IMAGE の形式が正しくありません（例: ghcr.io/org/image:tag）');
  }
  
  // CPUとメモリの値チェック
  if (config.cpu < 256 || config.memory < 512) {
    throw new Error('CPU は最低256、MEMORY は最低512である必要があります');
  }
  
  // VPC CIDRの形式チェック
  if (!/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\/\d{1,2}$/.test(config.vpcCidr)) {
    throw new Error('VPC_CIDR の形式が正しくありません（例: 10.0.0.0/16）');
  }
  
  // サブネットマスクの範囲チェック
  if (config.publicSubnetMask < 16 || config.publicSubnetMask > 28) {
    throw new Error('PUBLIC_SUBNET_MASK は16〜28の範囲内である必要があります');
  }
  
  if (config.privateSubnetMask < 16 || config.privateSubnetMask > 28) {
    throw new Error('PRIVATE_SUBNET_MASK は16〜28の範囲内である必要があります');
  }
  
  // NATゲートウェイの数のチェック
  if (config.natGateways < 1) {
    throw new Error('NAT_GATEWAYS は少なくとも1つ必要です');
  }
}
