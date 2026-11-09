import * as path from 'node:path';

export const FIXTURES = path.resolve(__dirname, '..', 'fixtures');
export const fixture = (...p: string[]) => path.join(FIXTURES, ...p);
