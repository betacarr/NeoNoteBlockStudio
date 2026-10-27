export function installElectron(options?: {
  platform?: 'darwin' | 'win32' | 'linux';
  arch?: string;
  destination?: string;
}): Promise<string>;
