import * as Lambda from 'aws-cdk-lib/aws-lambda-nodejs';
import { Construct } from 'constructs';
import { ConnectLambdaFunctionAssociation } from "cdk-amazon-connect-resources";

export class ConnectLambdaFunction extends Lambda.NodejsFunction {

    public readonly connectInstanceAssociation: ConnectLambdaFunctionAssociation;

    constructor(
        scope: Construct,
        id: string,
        props: Lambda.NodejsFunctionProps & { connectInstanceId: string },
    ) {
        super(scope, id, props);

        this.connectInstanceAssociation = new ConnectLambdaFunctionAssociation(this, 'functionAssociation', {
            connectInstanceId: props.connectInstanceId,
            functionArn: this.functionArn,
        });
    }

}
