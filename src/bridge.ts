import { ChildHandshake, ParentHandshake, WindowMessenger } from "post-me";
import type { Connection } from "post-me";
import { SkynetClient } from "skynet-js";

import { createIframe } from "./utils";
import { handshakeAttemptsInterval, handshakeMaxAttempts, providerKey } from "./consts";

export type Interface = Record<string, Array<string>>;

type BridgeInfo = {
  minimumInterface: Interface;
  relativeRouterUrl: string;
  routerName: string;
  routerW: number;
  routerH: number;
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
  protected receivedProviderUrl?: string;

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

    // Register listener for provider URL from the router.

    window.addEventListener("message", (event: MessageEvent) => {
      // Only consider messages from the same domain.
      if (event.origin !== location.origin)
        return;

      if (!event.data || event.data === "") {
        return;
      }

      // Set the provider URL as-is. Convert to subdomain-format later.
      this.receivedProviderUrl = event.data;
    });
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

    this.setProviderConnected(providerInterface);

    this.saveStoredProvider();
    return this.providerInfo;
  }

  protected async disconnectProvider(): Promise<ProviderInfo> {
    return this.disconnect().then(() => {
      this.setProviderDisconnected();
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

    // Ignore any caught error since we are in silent mode.
    try {
      const metadata = await this.launchProvider(providerMetadata.domain);
      this.setProviderLoaded(metadata);

      // Try to connect to stored provider.
      // TODO: Get provider info here instead, set final state depending on final value
      const providerInterface = await this.connectSilently(skappInfo);
      this.setProviderConnected(providerInterface);

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
    if (!this.receivedProviderUrl) {
      throw new Error("Did not receive provider URL");
    }
    // Format the provider URL.
    const providerUrl = this.formatProviderUrl(this.receivedProviderUrl);
    // Erase the received provider URL.
    this.receivedProviderUrl = undefined;

    // Launch the provider.
    const metadata = await this.launchProvider(providerUrl);
    this.setProviderLoaded(metadata);

    // TODO: Get provider info here instead, set final state depending on final value
    const providerInterface = await this.connectWithInput(skappInfo);
    this.setProviderConnected(providerInterface);

    this.saveStoredProvider();

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
    if (!localStorage) {
      console.log("WARNING: localStorage disabled");
      return null;
    }

    const metadata = localStorage.getItem(providerKey);
    if (!metadata) {
      return null;
    }
    const result: ProviderMetadata = JSON.parse(metadata);
    return result;
  }

  protected clearStoredProvider(): void {
    if (!localStorage) {
      console.log("WARNING: localStorage disabled");
      return;
    }

    localStorage.removeItem(providerKey);
  }

  protected formatProviderUrl(providerUrl: string): string {
    // Get base32 skylink.
    providerUrl = this.client.getSkylinkUrl(providerUrl, { subdomain: true });
    // TODO: This is necessary because getSkylinkUrl() currently prepends the base32 skylink to the existing subdomain instead of replacing it. Remove once getSkylinkUrl() is fixed.
    const providerUrlArr = providerUrl.split(".");
    providerUrlArr.splice(1,1);
    providerUrl = providerUrlArr.join(".");
    return providerUrl
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
    this.providerHandshake = ParentHandshake(messenger, {}, handshakeMaxAttempts, handshakeAttemptsInterval);

    const connection = await this.providerHandshake;
    return connection.remoteHandle().call("getMetadata");
  }

  protected setProviderConnected(providerInterface: Interface): void {
    this.providerInfo.isProviderConnected = true;
    this.providerInfo.providerInterface = providerInterface;
  }

  protected setProviderDisconnected(): void {
    this.providerInfo.isProviderConnected = false;
  }

  protected setProviderLoaded(metadata: ProviderMetadata): void {
    this.providerInfo.isProviderLoaded = true;
    this.providerInfo.metadata = metadata;
  }

  protected setProviderUnloaded(): void {
    this.providerInfo = emptyProviderInfo;
  }

  /**
   * Stores the current provider in the bridge's localStorage.
   */
  protected saveStoredProvider(): void {
    if (!localStorage) {
      console.log("WARNING: localStorage disabled");
      return;
    }

    localStorage.setItem(providerKey, JSON.stringify(this.providerInfo.metadata));
  }
}
