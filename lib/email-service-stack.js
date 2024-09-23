const { Stack, Duration } = require('aws-cdk-lib');
const lambda = require('aws-cdk-lib/aws-lambda');
const apigateway = require('aws-cdk-lib/aws-apigateway');
const dynamodb = require('aws-cdk-lib/aws-dynamodb');
const sqs = require('aws-cdk-lib/aws-sqs');
const lambdaEventSource = require('aws-cdk-lib/aws-lambda-event-sources');
const iam = require('aws-cdk-lib/aws-iam');

class EmailServiceStack extends Stack {
  constructor(scope, id, props) {
    super(scope, id, props);

    // create the SQS queue
    const orderQueue = new sqs.Queue(this, 'OrderProcessingQueue', {
      visibilityTimeout: Duration.seconds(45),
      queueName: 'order-processing-queue',
    });

    // create an SQS event source
    const lambdaSqsEventSource = new lambdaEventSource.SqsEventSource(orderQueue, {
      batchSize: 10,
      enabled: true,
    });

    // create the lambda responsible for processing orders
    const processOrderFunction = new lambda.Function(this, 'ProcessOrderLambda', {
      code: lambda.Code.fromAsset('lambda'),
      handler: 'lambdas.processOrder',
      runtime: lambda.Runtime.NODEJS_18_X,
    });

    // attach the event source to the order processing lambda
    processOrderFunction.addEventSource(lambdaSqsEventSource);

    // grant the order process lambda permission to invoke SES
    processOrderFunction.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['ses:SendRawEmail', 'ses:SendTemplatedEmail', 'ses:SendEmail'],
      resources: ['*'],
      sid: 'SendEmailPolicySid',
    }));

    // provision the DynamoDB order table
    const orderTable = new dynamodb.Table(this, 'OrderTable', {
      partitionKey: { name: 'orderId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      encryption: dynamodb.TableEncryption.DEFAULT,
      pointInTimeRecovery: false,
    });

    // create the Lambda function to create the order
    const createOrderFunction = new lambda.Function(this, 'CreateOrderLambda', {
      code: lambda.Code.fromAsset('lambda'),
      handler: 'lambdas.createOrder',
      runtime: lambda.Runtime.NODEJS_18_X,
      memorySize: 256,
      timeout: Duration.seconds(10),
      environment: {
        ORDER_TABLE_NAME: orderTable.tableName,
        ORDER_PROCESSING_QUEUE_URL: orderQueue.queueUrl,
        ADMIN_EMAIL: 'jyotisubhra02@gmail.com',
      },
    });

    orderTable.grantWriteData(createOrderFunction); // allow the createOrder lambda to write to DynamoDB
    orderQueue.grantSendMessages(createOrderFunction); // allow the createOrder lambda to send messages to the queue

    // create an API Gateway REST API
    const restApi = new apigateway.RestApi(this, 'EmailServiceApi', {
      restApiName: 'EmailService',
    });

    // create an API Gateway resource '/orders/new'
    const newOrders = restApi.root.addResource('orders').addResource('new');
    
    // create a POST method for the new order resource
    newOrders.addMethod('POST', new apigateway.LambdaIntegration(createOrderFunction), {
      authorizationType: apigateway.AuthorizationType.NONE,
    });
  }
}

module.exports = { EmailServiceStack };
