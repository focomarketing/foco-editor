import type { IncomingMessage, ServerResponse } from 'node:http';

export declare const mediaDir: () => string;
export declare const projectsDir: () => string;
export declare function handleLocal(req: IncomingMessage, res: ServerResponse, url: string, opts?: { desktop?: boolean }): Promise<unknown>;
