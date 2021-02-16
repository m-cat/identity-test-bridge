import { ChildHandshake, ParentHandshake, WindowMessenger } from "post-me";
import type { Connection } from "post-me";
import { SkynetClient } from "skynet-js";

import { createIframe, popupCenter } from "./utils";

export type Interface = Record<string, Array<string>>;

const providerKey = "provider";
const routerName = "Identity Router";
const [routerW, routerH] = [400, 500];

type BridgeInfo = {
  minimumInterface: Interface;
  relativeRouterUrl: string;
}

type ProviderInfo = {
  providerInterface: Interface | null;
  isProviderConnected: boolean;
  isProviderLoaded: boolean;
  metadata: ProviderMetadata | null;
};

const emptyProviderInfo = {
  providerInterface: null,
  isProviderConnected: false,
  isProviderLoaded: false,
  metadata: null,
};

type ProviderMetadata = {
  name: string;
  domain: string;
};

class SkappInfo {
  name: string;
  domain: string;

  constructor(name: string) {
    this.name = name;
    this.domain = location.hostname;
  }
}

export class Bridge {
  bridgeInfo: BridgeInfo;
  providerInfo: ProviderInfo;

  protected childFrame?: HTMLIFrameElement;
  protected client: SkynetClient;
  protected parentHandshake: Promise<Connection>;
  protected providerHandshake?: Promise<Connection>;

  constructor(bridgeInfo: BridgeInfo) {
    if (typeof Storage == "undefined") {
      throw new Error("Browser does not support web storage");
    }

    // Set the bridge info.

    this.bridgeInfo = bridgeInfo;

    // Enable communication with parent skapp.

    const methods = {
      callInterface: (method: string) => this.callInterface(method),
      connectProvider: (skappInfo: SkappInfo) => this.connectProvider(skappInfo),
      disconnectProvider: () => this.disconnectProvider(),
      fetchStoredProvider: (skappInfo: SkappInfo) => this.fetchStoredProvider(skappInfo),
      getBridgeInfo: () => this.getBridgeInfo(),
      getProviderInfo: () => this.getProviderInfo(),
      loadNewProvider: (skappInfo: SkappInfo) => this.loadNewProvider(skappInfo),
      unloadProvider: () => this.unloadProvider(),
    };
    const messenger = new WindowMessenger({
      localWindow: window,
      remoteWindow: window.parent,
      remoteOrigin: "*",
    });
    this.parentHandshake = ChildHandshake(messenger, methods);

    // Initialize an empty provider info.

    this.providerInfo = emptyProviderInfo;
    this.providerHandshake = undefined;

    // Initialize the Skynet client.
    this.client = new SkynetClient();
  }

  // =================
  // Public Bridge API
  // =================

  protected async callInterface(method: string): Promise<unknown> {
    if (!this.providerInfo.isProviderConnected) {
      throw new Error("Provider not connected, cannot access interface");
    }
    if (!this.providerInfo.providerInterface) {
      throw new Error("Provider interface not present despite being connected. Possible logic bug");
    }
    if (!this.providerHandshake) {
      throw new Error("Provider connection not established, possible logic bug");
    }

    // TODO: This check doesn't work.
    // if (method in this.providerInfo.providerInterface) {
    //   throw new Error(
    //     `Unsupported method for this provider interface. Method: '${method}', Interface: ${this.providerInfo.providerInterface}`
    //   );
    // }

    const connection = await this.providerHandshake;
    return connection.remoteHandle().call("callInterface", method);
  }

  protected async connectProvider(skappInfo: SkappInfo): Promise<ProviderInfo> {
    const providerInterface = await this.connectWithInput(skappInfo);

    this.providerInfo.isProviderConnected = true;
    this.providerInfo.providerInterface = providerInterface;

    this.saveStoredProvider();
    return this.providerInfo;
  }

  protected async disconnectProvider(): Promise<ProviderInfo> {
    return this.disconnect().then(() => {
      this.providerInfo.isProviderConnected = false;
      return this.providerInfo;
    });
  }

  protected async getBridgeInfo(): Promise<BridgeInfo> {
    return this.bridgeInfo;
  }

  protected async getProviderInfo(): Promise<ProviderInfo> {
    return this.providerInfo;
  }

  /**
   * Tries to fetch the stored provider, silently trying to connect to it if one is found.
   */
  protected async fetchStoredProvider(skappInfo: SkappInfo): Promise<ProviderInfo> {
    // Check for stored provider.

    const providerMetadata = this.checkForStoredProvider();

    if (!providerMetadata) {
      this.setProviderUnloaded();
      return this.providerInfo;
    }

    // Launch the stored provider and try to connect to it without user input.

    try {
      const metadata = await this.launchProvider(providerMetadata.domain);
      this.providerInfo.isProviderLoaded = true;
      this.providerInfo.metadata = metadata;

      // Try to connect to stored provider.
      try {
        const providerInterface = await this.connectSilently(skappInfo);
        this.providerInfo.isProviderConnected = true;
        this.providerInfo.providerInterface = providerInterface;
      } catch (error) {
        this.providerInfo.isProviderConnected = false;
      }

      this.saveStoredProvider();
    } catch(error) {
      this.setProviderUnloaded();
    }
    return this.providerInfo;
  }

  /**
   * Loads a new provider, as opposed to a stored one, by asking the user for it.
   */
  protected async loadNewProvider(skappInfo: SkappInfo): Promise<ProviderInfo> {
    // TODO: Add clean removal of old provider.

    // Launch router.
    try {
      const providerUrl = await this.launchRouter();

      // Launch the provider.
      const metadata = await this.launchProvider(providerUrl);
      this.providerInfo.isProviderLoaded = true;
      this.providerInfo.metadata = metadata;

      try {
        const providerInterface = await this.connectWithInput(skappInfo);
        this.providerInfo.isProviderConnected = true;
        this.providerInfo.providerInterface = providerInterface;
      } catch(error) {
        this.providerInfo.isProviderConnected = false;
      }

      this.saveStoredProvider();
    } catch(error) {
      // Don't change anything here. On error we should retain the previous state.
    }

    return this.providerInfo;
  }

  /**
   * Destroys the loaded provider and sets the state to unloaded.
   */
  protected async unloadProvider(): Promise<ProviderInfo> {
    if (!this.providerHandshake) {
      throw new Error("provider connection not established, cannot unload a provider that was not loaded");
    }

    if (this.providerInfo.isProviderConnected) {
      try {
        await this.disconnect();
      } catch (error) {
        console.log(error);
      }
    }

    this.providerInfo = emptyProviderInfo;
    this.clearStoredProvider();

    // Close the child iframe.
    if (this.childFrame) {
      this.childFrame.parentNode!.removeChild(this.childFrame);
    }

    await this.providerHandshake.then((connection) => connection.close());

    return this.providerInfo;
  }

  // =======================
  // Internal Provider Calls
  // =======================

  // TODO: Reject provider if it doesn't satisfy minimum interface.
  /**
   * Tries to connect to the provider, connecting even if the user isn't already logged in to the provider (as opposed to connectSilently()).
   */
  protected async connectWithInput(skappInfo: SkappInfo): Promise<Interface> {
    if (!this.providerHandshake) {
      throw new Error("provider connection not established, possible logic bug");
    }

    const connection = await this.providerHandshake;
    return connection.remoteHandle().call("connectWithInput", skappInfo);
  }

  protected async disconnect(): Promise<void> {
    if (!this.providerHandshake) {
      throw new Error("provider connection not established, possible logic bug");
    }

    const connection = await this.providerHandshake;
    return connection.remoteHandle().call("disconnect");
  }

  // TODO: Reject provider if it doesn't satisfy minimum interface.
  /**
   * Tries to connect to the provider, only connecting if the user is already logged in to the provider (as opposed to connectWithInput()).
   */
  protected async connectSilently(skappInfo: SkappInfo): Promise<Interface> {
    if (!this.providerHandshake) {
      throw new Error("provider connection not established, possible logic bug");
    }

    const connection = await this.providerHandshake;
    return connection.remoteHandle().call("connectSilently", skappInfo);
  }

  // =======================
  // Internal Bridge Methods
  // =======================

  /**
   * Checks for provider stored in the bridge's local storage.
   *
   * @returns - The provider metadata including URL and name.
   */
  protected checkForStoredProvider(): ProviderMetadata | null {
    const metadata = localStorage.getItem(providerKey);
    if (!metadata) {
      return null;
    }
    const result: ProviderMetadata = JSON.parse(metadata);
    return result;
  }

  protected clearStoredProvider(): void {
    localStorage.removeItem(providerKey);
  }

  /**
   * Launches the iframe with the provider and establish a connection.
   */
  protected async launchProvider(providerUrl: string): Promise<ProviderMetadata> {
    // TODO: Check for valid base32 providerUrl here.

    // Create the iframe.
    this.childFrame = createIframe(providerUrl);
    const childWindow = this.childFrame.contentWindow!;

    // Connect to the iframe.
    const messenger = new WindowMessenger({
      localWindow: window,
      remoteWindow: childWindow,
      remoteOrigin: "*",
    });
    this.providerHandshake = ParentHandshake(messenger);

    const connection = await this.providerHandshake;
    return connection.remoteHandle().call("getMetadata");
  }

  // TODO: should check periodically if window is still open.
  /**
   * Creates window with router and waits for a response.
   */
  protected async launchRouter(): Promise<string> {
    // Set the router URL.
    const routerUrl = "router.html";

    const promise: Promise<string> = new Promise((resolve, reject) => {
      // Register a message listener.
      const handleMessage = (event: MessageEvent) => {
        if (event.origin !== location.origin)
          return;

        window.removeEventListener("message", handleMessage);

        // Resolve or reject the promise.

        if (!event.data || event.data === "") {
          reject(new Error("did not get a provider URL"));
        }
        // Get base32 skylink.
        let providerUrl = this.client.getSkylinkUrl(event.data, { subdomain: true });
        // TODO: This is necessary because getSkylinkUrl() currently prepends the base32 skylink to the existing subdomain instead of replacing it. Remove once getSkylinkUrl() is fixed.
        const providerUrlArr = providerUrl.split(".");
        providerUrlArr.splice(1,1);
        providerUrl = providerUrlArr.join(".");

        resolve(providerUrl);
      };

      window.addEventListener("message", handleMessage);
    });

    // Open the router.
    const newWindow = popupCenter(routerUrl, routerName, routerW, routerH);

    return promise;
  }

  protected setProviderUnloaded(): void {
    this.providerInfo = emptyProviderInfo;
  }

  /**
   * Stores the current provider in the bridge's localStorage.
   */
  protected saveStoredProvider(): void {
    localStorage.setItem(providerKey, JSON.stringify(this.providerInfo.metadata));
  }
}
