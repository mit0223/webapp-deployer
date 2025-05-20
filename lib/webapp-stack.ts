import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as ecr from 'aws-cdk-lib/aws-ecr';
import * as ecsPatterns from 'aws-cdk-lib/aws-ecs-patterns';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as logs from 'aws-cdk-lib/aws-logs';
import { Construct } from 'constructs';
import { EnvironmentConfig } from '../src/utils/config';

export class WebAppStack extends cdk.Stack {
  constructor(scope: Construct, id: string, config: EnvironmentConfig, props?: cdk.StackProps) {
    super(scope, id, props);

    // VPCの作成
    const vpc = this.createVpc(config);

    // ECSクラスターの作成
    const cluster = new ecs.Cluster(this, 'WebAppCluster', {
      vpc,
      clusterName: `${config.appName}-cluster`,
      containerInsights: true,
    });

    // Fargateサービスの作成
    this.createFargateService(cluster, config);
  }

  /**
   * VPCとサブネットを作成
   */
  private createVpc(config: EnvironmentConfig): ec2.Vpc {
    // AZを最大3つ使用
    const maxAzs = 3;
    
    // サブネットの設定
    const subnetConfiguration: ec2.SubnetConfiguration[] = [
      {
        name: 'public',
        subnetType: ec2.SubnetType.PUBLIC,
        cidrMask: config.publicSubnetMask,
      },
      {
        name: 'private',
        subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
        cidrMask: config.privateSubnetMask,
      },
    ];

    // VPCの作成
    return new ec2.Vpc(this, 'WebAppVpc', {
      vpcName: `${config.appName}-vpc`,
      maxAzs,
      cidr: config.vpcCidr,
      subnetConfiguration,
      natGateways: config.natGateways,
    });
  }

  /**
   * Fargateサービスを作成
   */
  private createFargateService(cluster: ecs.Cluster, config: EnvironmentConfig): ecsPatterns.ApplicationLoadBalancedFargateService {
    // タスク実行ロールを作成
    const executionRole = this.createTaskExecutionRole();
    
    // タスクロールを作成
    const taskRole = this.createTaskRole();
    
    // ログの設定
    const logGroup = new logs.LogGroup(this, 'WebAppLogGroup', {
      logGroupName: `/ecs/${config.appName}`,
      retention: logs.RetentionDays.ONE_MONTH,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });
    
    // タスク定義を作成
    const taskDefinition = new ecs.FargateTaskDefinition(this, 'WebAppTask', {
      family: `${config.appName}-task`,
      cpu: config.cpu,
      memoryLimitMiB: config.memory,
      executionRole,
      taskRole,
    });
    
    // コンテナを追加
    const container = taskDefinition.addContainer('WebAppContainer', {
      image: ecs.ContainerImage.fromRegistry(config.containerImage),
      essential: true,
      logging: ecs.LogDrivers.awsLogs({
        streamPrefix: config.appName,
        logGroup,
      }),
      portMappings: [
        {
          containerPort: config.containerPort,
          protocol: ecs.Protocol.TCP,
        },
      ],
      healthCheck: {
        command: ['CMD-SHELL', `curl -f http://localhost:${config.containerPort}${config.healthCheckPath} || exit 1`],
        interval: cdk.Duration.seconds(30),
        timeout: cdk.Duration.seconds(5),
        retries: 3,
        startPeriod: cdk.Duration.seconds(60),
      },
    });
    
    // ALB付きFargateサービスを作成
    const service = new ecsPatterns.ApplicationLoadBalancedFargateService(this, 'WebAppService', {
      serviceName: `${config.appName}-service`,
      cluster,
      taskDefinition,
      desiredCount: config.desiredCount,
      publicLoadBalancer: true,
      listenerPort: config.albPort,
      assignPublicIp: false,
      healthCheckGracePeriod: cdk.Duration.seconds(60),
    });
    
    // ALBのヘルスチェック設定
    service.targetGroup.configureHealthCheck({
      path: config.healthCheckPath,
      port: `${config.containerPort}`,
      healthyHttpCodes: '200',
      interval: cdk.Duration.seconds(30),
      timeout: cdk.Duration.seconds(5),
      healthyThresholdCount: 2,
      unhealthyThresholdCount: 3,
    });
    
    // Auto Scalingの設定
    const scaling = service.service.autoScaleTaskCount({
      minCapacity: config.desiredCount,
      maxCapacity: config.desiredCount * 3,
    });
    
    scaling.scaleOnCpuUtilization('CpuScaling', {
      targetUtilizationPercent: 70,
      scaleInCooldown: cdk.Duration.seconds(60),
      scaleOutCooldown: cdk.Duration.seconds(60),
    });
    
    // スタックの出力
    new cdk.CfnOutput(this, 'LoadBalancerDNS', {
      value: service.loadBalancer.loadBalancerDnsName,
      description: 'Webアプリケーションのロードバランサーのドメイン名',
      exportName: `${config.appName}-lb-dns`,
    });
    
    new cdk.CfnOutput(this, 'ServiceURL', {
      value: `http://${service.loadBalancer.loadBalancerDnsName}`,
      description: 'Webアプリケーションの URL',
      exportName: `${config.appName}-url`,
    });
    
    return service;
  }

  /**
   * タスク実行ロールを作成
   */
  private createTaskExecutionRole(): iam.Role {
    const executionRole = new iam.Role(this, 'WebAppTaskExecutionRole', {
      assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AmazonECSTaskExecutionRolePolicy'),
      ],
    });
    
    return executionRole;
  }

  /**
   * タスクロールを作成
   */
  private createTaskRole(): iam.Role {
    const taskRole = new iam.Role(this, 'WebAppTaskRole', {
      assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
    });
    
    // ここに必要なポリシーを追加
    
    return taskRole;
  }
}
