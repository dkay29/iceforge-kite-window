#!/usr/bin/env node
import { App } from 'aws-cdk-lib';
import { FoundationStack } from '../lib/foundation-stack.js';

const app = new App();

new FoundationStack(app, 'IceforgeFoundationStack');
