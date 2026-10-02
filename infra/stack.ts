import * as CDK from 'aws-cdk-lib';
import * as Lambda from 'aws-cdk-lib/aws-lambda';
import * as Connect from 'aws-cdk-lib/aws-connect';
import { IConstruct } from 'constructs';
import { ConnectExistingPrompt } from "cdk-amazon-connect-resources";
import {transformAndValidateSync} from "class-transformer-validator";

import {Environment} from "./environment";
import {ConnectLexBot} from './ConnectLexBot';
import {ConnectLambdaFunction} from "./ConnectLambdaFunction";
import {generateMainContactFlowContent, generateQueueContactFlowContent,} from "../contact-flow";

const environment: Environment = transformAndValidateSync(Environment, process.env);

const stackNameKebab: string = `cdk-amazon-connect-${environment.ACCOUNT_ID}`;

const app = new CDK.App();
const stack = new CDK.Stack(app, stackNameKebab, {
    env: {
        account: environment.ACCOUNT_ID,
        region: environment.REGION,
    }
});

// Reusing the existing "contact-center-sandbox" Connect instance instead of
// provisioning a new one, to practice adding flows/queue/security profile without
// hitting the per-account Connect instance limit.
const connectInstanceId =  environment.CONNECT_INSTANCE_ID;
const connectInstanceArn = `arn:aws:connect:${environment.REGION}:${environment.ACCOUNT_ID}:instance/${connectInstanceId}`;

const menuBot = new ConnectLexBot(stack, 'menuBot', {
    connectInstanceId,
    name: `${stackNameKebab}-menu`,
    autoBuildBotLocales: true,
    idleSessionTtlInSeconds: 123,
    dataPrivacy: {
        ChildDirected: false
    },
    botLocales: [{
        localeId: 'en_US',
        nluConfidenceThreshold: 0.75,
        intents: [
            {
                name: 'GetHours',
                sampleUtterances: ['get hours', 'hours', 'hours today', 'get today\'s hours'].map((utterance) => {return {utterance}})
            },
            {
                name: 'GetSpecials',
                sampleUtterances: ['get specials', 'specials', 'specials today', 'get today\'s specials'].map((utterance) => {return {utterance}}),
            },
            {
                name: 'SpeakToSomeone',
                sampleUtterances: ['transfer', 'speak to agent', 'speak to someone', 'agent'].map((utterance) => {return {utterance}}),
            },
            {
                name: 'FallbackIntent',
                parentIntentSignature: "AMAZON.FallbackIntent",
            }
        ],
    }],
});

const getTodaysHoursLambda = new ConnectLambdaFunction(stack, 'getTodaysHoursLambda', {
    connectInstanceId,
    handler: 'handler',
    entry: './lambda/GetTodaysHours.ts',
    functionName: `${stackNameKebab}-todays-hours`,
    runtime: Lambda.Runtime.NODEJS_18_X,
    timeout: CDK.Duration.seconds(8),
});

const getTodaysSpecialsLambda = new ConnectLambdaFunction(stack, 'getTodaysSpecialsLambda', {
    connectInstanceId,
    handler: 'handler',
    entry: './lambda/GetTodaysSpecials.ts',
    functionName: `${stackNameKebab}-todays-specials`,
    runtime: Lambda.Runtime.NODEJS_18_X,
    timeout: CDK.Duration.seconds(8),
});

const queueHoursOfOperation = new Connect.CfnHoursOfOperation(stack, 'queueHoursOfOperation', {
    config: [
        'MONDAY',
        'TUESDAY',
        'WEDNESDAY',
        'THURSDAY',
        'FRIDAY',
    ].map((day) => {
        return {
            day,
            startTime: {
                hours: 9,
                minutes: 0,
            },
            endTime: {
                hours: 17,
                minutes: 0,
            },
        }
    }),
    instanceArn: connectInstanceArn,
    name: "QueueHoursOfOperation",
    timeZone: "America/New_York",
})

const queue = new Connect.CfnQueue(stack, 'queue', {
    instanceArn: connectInstanceArn,
    name: "MainQueue",
    hoursOfOperationArn: queueHoursOfOperation.attrHoursOfOperationArn,
});
queue.applyRemovalPolicy(CDK.RemovalPolicy.RETAIN);

const prompt = new ConnectExistingPrompt(stack, 'prompt', {
    connectInstanceId,
    promptName: "Music_Jazz_MyTimetoFly_Inst.wav",
})

const queueFlow = new Connect.CfnContactFlow(stack, 'queueFlow', {
    name: 'QueueFlow',
    state: 'ACTIVE',
    type: "CUSTOMER_QUEUE",
    content: generateQueueContactFlowContent(prompt),
    instanceArn: connectInstanceArn,
});

const mainContactFlow = new Connect.CfnContactFlow(stack, 'mainContactFlow', {
    name: 'MainFlow',
    state: 'ACTIVE',
    type: "CONTACT_FLOW",
    content: generateMainContactFlowContent(
        menuBot.lexBotAlias.attrArn,
        getTodaysHoursLambda.functionArn,
        getTodaysSpecialsLambda.functionArn,
        queue.attrQueueArn,
        queueFlow.attrContactFlowArn,
    ),
    instanceArn: connectInstanceArn,
});

// Phone number intentionally omitted — reusing the existing instance's
// number(s), and avoiding the recurring cost of provisioning a new DID.

const routingProfile = new Connect.CfnRoutingProfile(stack, 'routingProfile', {
    instanceArn: connectInstanceArn,
    name: 'DefaultRoutingProfile',
    description: "The default routing profile.",
    defaultOutboundQueueArn: queue.attrQueueArn,
    queueConfigs: [
        {
            delay: 10,
            priority: 1,
            queueReference: {
                channel: "VOICE",
                queueArn: queue.attrQueueArn,
            }
        },
    ],
    mediaConcurrencies: [
        {
            channel: "VOICE",
            concurrency: 1,
        }
    ],
});
routingProfile.applyRemovalPolicy(CDK.RemovalPolicy.RETAIN);

const securityProfile = new Connect.CfnSecurityProfile(stack, 'securityProfile', {
    instanceArn: connectInstanceArn,
    securityProfileName: "DefaultSecurityProfile",
    permissions: [
        "BasicAgentAccess",
        "OutboundCallAccess",
        "RoutingPolicies.View",
        "TransferDestinations.View",
        "HoursOfOperation.View",
        "Queues.View",
        "ContactFlows.View",
        "ContactFlowModules.View",
        "PhoneNumbers.View",
        "Prompts.View",
        "Users.View",
        "AgentStates.View",
        "ContactAttributes.View",
        "ContactSearch.View",
        "AgentTimeCard.View",
        "MetricsReports.View",
        "ReportSchedules.View",
        "TaskTemplates.View",
        "VoiceIdAttributesAndSearch.View"
    ]
});

new Connect.CfnUser(stack, 'Fred', {
    instanceArn: connectInstanceArn,
    username: "fredjones",
    password: "cHANGEmE123", // Needs 8+, one upper, one lower, one digit
    identityInfo: {
        firstName: 'Fred',
        lastName: 'Jones',
        email: 'fjones@fredsfishmarket.com'
    },
    phoneConfig: {
        phoneType: 'SOFT_PHONE',
    },
    routingProfileArn: routingProfile.attrRoutingProfileArn,
    securityProfileArns: [
        securityProfile.attrSecurityProfileArn
    ],
})

// cdk-amazon-connect-resources' shared ConnectCustomResourceLambda (backing
// prompt, the Lex bot association, and both Lambda function associations)
// has no memorySize set and defaults to 128MB, which was OOM-killed
// ("signal: killed") on the last deploy attempt. Bump it directly since
// there's no prop on those constructs to set it ourselves.
class IncreaseCustomResourceLambdaMemory implements CDK.IAspect {
    visit(node: IConstruct): void {
        if (node instanceof Lambda.CfnFunction && node.node.path.includes('ConnectCustomResourceLambda')) {
            node.addPropertyOverride('MemorySize', 512);
        }
    }
}
CDK.Aspects.of(stack).add(new IncreaseCustomResourceLambdaMemory());

app.synth();
