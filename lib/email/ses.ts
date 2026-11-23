// Amazon SES v2 SendEmail: https://docs.aws.amazon.com/ses/latest/APIReference-V2/API_SendEmail.html
// POST https://email.<region>.amazonaws.com/v2/email/outbound-emails, signed with SigV4 by aws4fetch (no AWS SDK).
import { AwsClient } from 'aws4fetch';
import { clean, EmailError, errorText, postJson, type EmailProvider } from './types';

const region = (env: Record<string, string | undefined>) => env.AWS_SES_REGION || env.AWS_REGION;

export const ses: EmailProvider = {
  missing: (env) => [
    ...(region(env) ? [] : ['AWS_SES_REGION']),
    ...['AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY'].filter((k) => !env[k]),
  ],
  async send(msg, from, env) {
    const r = region(env)!;
    const secrets = [env.AWS_ACCESS_KEY_ID, env.AWS_SECRET_ACCESS_KEY, env.AWS_SESSION_TOKEN];
    const aws = new AwsClient({
      accessKeyId: env.AWS_ACCESS_KEY_ID!, secretAccessKey: env.AWS_SECRET_ACCESS_KEY!, sessionToken: env.AWS_SESSION_TOKEN || undefined,
      service: 'ses', region: r, retries: 0,
    });
    const utf8 = (Data: string) => ({ Data, Charset: 'UTF-8' });
    const req = await aws.sign(`https://email.${r}.amazonaws.com/v2/email/outbound-emails`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        FromEmailAddress: from,
        Destination: { ToAddresses: [msg.to] },
        Content: { Simple: { Subject: utf8(msg.subject), Body: { Text: utf8(msg.text), Html: utf8(msg.html) } } },
        ...(env.AWS_SES_CONFIGURATION_SET ? { ConfigurationSetName: env.AWS_SES_CONFIGURATION_SET } : {}),
      }),
    });
    const { res, body } = await postJson('ses', req);
    if (!res.ok) {
      const type = res.headers.get('x-amzn-ErrorType')?.split(':')[0];
      const t = clean(errorText(body, ['message', 'Message']), secrets);
      throw new EmailError('ses', `HTTP ${res.status}${type ? ` ${type}` : ''}${t ? `: ${t}` : ''}`);
    }
  },
};
