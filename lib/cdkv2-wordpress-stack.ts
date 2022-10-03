import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import * as rds from "aws-cdk-lib/aws-rds";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as secretsManager from "aws-cdk-lib/aws-secretsmanager";
import * as efs from "aws-cdk-lib/aws-efs";
import * as ecsPatterns from "aws-cdk-lib/aws-ecs-patterns";
import * as ecs from "aws-cdk-lib/aws-ecs";

export class Cdkv2WordpressStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const vpc = new ec2.Vpc(this, "wp-vpc");
    const credSecret = new secretsManager.Secret(this, "db-secret", {
      secretName: "/hasura",
      generateSecretString: {
        passwordLength: 20,
        excludePunctuation: true,
      },
    });

    const db = new rds.DatabaseCluster(this, "wp-db", {
      engine: rds.DatabaseClusterEngine.auroraMysql({
        version: rds.AuroraMysqlEngineVersion.VER_3_02_0,
      }),
      instanceProps: {
        instanceType: ec2.InstanceType.of(
          ec2.InstanceClass.R5,
          ec2.InstanceSize.LARGE
        ),
        vpc,
        vpcSubnets: {
          subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
        },
      },
      credentials: rds.Credentials.fromPassword(
        "matthew",
        credSecret.secretValue
      ),
      defaultDatabaseName: "wordpress",
    });
    const fs = new efs.FileSystem(this, "fs", {
      fileSystemName: "wordpress",
      vpc,
      vpcSubnets: {
        subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
      },
    });

    const wp = new ecsPatterns.ApplicationLoadBalancedFargateService(
      this,
      "wpsvc",
      {
        taskImageOptions: {
          image: ecs.ContainerImage.fromRegistry("library/wordpress:latest"),
          environment: {
            WORDPRESS_DB_NAME: "wordpress",
            WORDPRESS_DB_USER: "matthew",
            WORDPRESS_DB_PASSWORD: credSecret.secretValue.unsafeUnwrap(),
            WORDPRESS_DB_HOST: db.clusterEndpoint.hostname,
            WORDPRESS_TABLE_PREFIX: "wp_",
          },
        },
        cpu: 256,
        memoryLimitMiB: 1024,
        vpc,
        taskSubnets: {
          subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
        },
      }
    );

    wp.node.addDependency(db);

    db.connections.allowDefaultPortFrom(wp.service.connections);
    fs.connections.allowDefaultPortFrom(wp.service.connections);
    wp.taskDefinition.addVolume({
      efsVolumeConfiguration: {
        fileSystemId: fs.fileSystemId,
      },
      name: "wp-vol",
    });
    wp.taskDefinition.defaultContainer?.addMountPoints({
      containerPath: "/var/www/html",
      readOnly: false,
      sourceVolume: "wp-vol",
    });
    wp.targetGroup.configureHealthCheck({
      path: "/",
      healthyHttpCodes: "200-399",
    });
    const targetScaling = wp.service.autoScaleTaskCount({
      minCapacity: 3,
      maxCapacity: 40,
    });

    targetScaling.scaleOnCpuUtilization("cpuScaling", {
      targetUtilizationPercent: 75,
    });

    targetScaling.scaleOnMemoryUtilization("memoryScaling", {
      targetUtilizationPercent: 75,
    });
  }
}
