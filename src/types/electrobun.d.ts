declare module "electrobun/bun" {
  export interface WindowOptionsType<T = any> {
    title?: string;
    url?: string;
    frame?: {
      width?: number;
      height?: number;
      x?: number;
      y?: number;
    };
    rpc?: T;
    titleBarStyle?: "default" | "hidden" | "hiddenInset" | "customButtonsOnHover";
    hidden?: boolean;
  }

  export interface MenuItemConfig {
    type?: "normal" | "separator" | "divider" | "checkbox" | "radio";
    label?: string;
    action?: string;
    enabled?: boolean;
    checked?: boolean;
    hidden?: boolean;
    tooltip?: string;
    data?: any;
    submenu?: MenuItemConfig[];
  }

  export class BrowserWindow {
    id: number;
    readonly ptr: any;
    readonly webview: BrowserView;
    url: string | null;
    constructor(options?: WindowOptionsType);
    focus(): void;
    activate(): void;
    show(): void;
    showInactive(): void;
    hide(): void;
    minimize(): void;
    unminimize(): void;
    isMinimized(): boolean;
    isVisible(): boolean;
    maximize(): void;
    unmaximize(): void;
    isMaximized(): boolean;
    close(): void;
    setTitle(title: string): void;
    setPosition(x: number, y: number): void;
    setSize(width: number, height: number): void;
    setFrame(x: number, y: number, width: number, height: number): void;
    getFrame(): { x: number; y: number; width: number; height: number };
    getPosition(): { x: number; y: number };
    getSize(): { width: number; height: number };
    on(name: string, handler: (event: any) => void): void;
  }

  export type RPCSchema<T = any> = T;

  export interface ElectrobunRPCConfig<T = any> {
    maxRequestTime?: number;
    handlers: {
      requests?: Record<string, (params: any) => Promise<any> | any>;
      messages?: Record<string, (params: any) => void>;
    };
  }

  export class BrowserView {
    id: number;
    url: string | null;
    static defineRPC<Schema = any>(config: ElectrobunRPCConfig): any;
    loadURL(url: string): void;
    loadHTML(html: string): void;
    executeJavascript(js: string): void;
  }

  export namespace Utils {
    export function openFileDialog(options?: {
      startingFolder?: string;
      allowedFileTypes?: string;
      canChooseFiles?: boolean;
      canChooseDirectory?: boolean;
      allowsMultipleSelection?: boolean;
      directory?: boolean;
      multiple?: boolean;
      title?: string;
      defaultPath?: string;
    }): Promise<string[] | string | null>;
    export function openExternal(url: string): Promise<void>;
    export function quit(code?: number): boolean;
  }

  export class Tray {
    constructor(options?: {
      title?: string;
      image?: string;
      template?: boolean;
      width?: number;
      height?: number;
    });
    setTitle(title: string): void;
    setImage(imgPath: string): void;
    setMenu(menu: Array<MenuItemConfig>): void;
    on(name: string, handler: (event: any) => void): void;
    setVisible(visible: boolean): void;
    remove(): void;
  }

  export class Updater {
    static updateInfo(): Promise<{ updateReady: boolean }>;
    static applyUpdate(): Promise<void>;
  }
}

declare module "electrobun/view" {
  export interface ElectroviewRPCConfig<T = any> {
    maxRequestTime?: number;
    handlers: {
      requests?: Record<string, (params: any) => Promise<any> | any>;
      messages?: Record<string, (params: any) => void>;
    };
  }

  export class Electroview<T = any> {
    static defineRPC<Schema = any>(config: ElectroviewRPCConfig): any;
    constructor(rpc: any);
    rpc: {
      request: {
        getConfig: (params: any) => Promise<any>;
        saveConfig: (params: any) => Promise<any>;
        getSyncStatus: (params: any) => Promise<any>;
        getRemoteDirectories: (params: any) => Promise<any>;
        triggerSync: (params: any) => Promise<any>;
        resolveConflict: (params: any) => Promise<any>;
        testConnection: (params: any) => Promise<any>;
        pickDirectory: (params: any) => Promise<any>;
        getActivityLog: (params: any) => Promise<any>;
        [key: string]: (params: any) => Promise<any>;
      };
      send: {
        [key: string]: (params: any) => void;
      };
    };
  }
}

declare module "electrobun" {
  export interface ElectrobunConfig {
    app: {
      name: string;
      identifier: string;
      version: string;
    };
    build?: {
      views?: Record<string, { entrypoint: string }>;
      copy?: Record<string, string>;
      linux?: {
        bundleCEF?: boolean;
      };
      mac?: Record<string, any>;
      win?: Record<string, any>;
    };
    runtime?: {
      exitOnLastWindowClosed?: boolean;
    };
  }
}
