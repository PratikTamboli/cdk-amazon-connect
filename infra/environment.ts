import {IsString, Matches} from 'class-validator';

export class Environment {

    @Matches(/^\d{12}$/)
    ACCOUNT_ID!: `${number}`;

    @IsString()
    REGION!: string;

    @Matches(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)
    CONNECT_INSTANCE_ID!: string;
}
