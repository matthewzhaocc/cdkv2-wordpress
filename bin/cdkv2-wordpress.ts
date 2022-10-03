#!/usr/bin/env node
import "source-map-support/register";
import * as cdk from "aws-cdk-lib";
import { Cdkv2WordpressStack } from "../lib/cdkv2-wordpress-stack";

const app = new cdk.App();
new Cdkv2WordpressStack(app, "Cdkv2WordpressStack");

import { Aspects } from "aws-cdk-lib";
import { HIPAASecurityChecks } from "cdk-nag";

Aspects.of(app).add(new HIPAASecurityChecks());
