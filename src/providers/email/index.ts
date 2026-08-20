import { EmailProvider } from './EmailProvider';
import { MockEmailProvider } from './MockEmailProvider';

export function getEmailProvider(): EmailProvider {
  return new MockEmailProvider();
}
