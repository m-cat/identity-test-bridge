import { ChildHandshake, ParentHandshake, WindowMessenger } from "post-me";
import type { Connection } from "post-me";
import { SkynetClient } from "skynet-js";

import { createIframe, ensureUrl } from "./utils";
import { handshakeAttemptsInterval, handshakeMaxAttempts, providerKey } from "./consts";

export type Interface = Record<string, Array<string>>;

type BridgeMetadata = {
  minimumInterface: Interface;

  relativeRouterUrl: string;
  routerName: string;
  routerW: number;
  routerH: number;
}

type ProviderStatus = {
  providerInterface: Interface | null;
  isProviderConnected: boolean;
  isProviderLoaded: boolean;
  metadata: ProviderMetadata | null;
};

const emptyProviderStatus = {
  providerInterface: null,
  isProviderConnected: false,
  isProviderLoaded: false,
  metadata: null,
};

type ProviderMetadata = {
  name: string;
  url: string;

  relativeConnectorPath: string;
  connectorName: string;
  connectorW: number;
  connectorH: number;
};

export type SkappInfo = {
  name: string;
  domain: string;
}

export class Bridge {
  bridgeMetadata: BridgeMetadata;
  providerStatus: ProviderStatus;

  protected childFrame?: HTMLIFrameElement;
  protected client: SkynetClient;
  protected connectionInfoListener?: EventListener;
  protected parentHandshake: Promise<Connection>;
  protected providerHandshake?: Promise<Connection>;
  protected receivedProviderUrl?: string;

  constructor(bridgeMetadata: BridgeMetadata) {
    if (typeof Storage == "undefined") {
      throw new Error("Browser does not support web storage");
    }

    // Set the bridge info.

    this.bridgeMetadata = bridgeMetadata;

    // Enable communication with parent skapp.

    const methods = {
      callInterface: (method: string) => this.callInterface(method),
      disconnectProvider: () => this.disconnectProvider(),
      fetchStoredProvider: (skappInfo: SkappInfo) => this.fetchStoredProvider(skappInfo),
      getBridgeMetadata: () => this.getBridgeMetadata(),
      getProviderStatus: () => this.getProviderStatus(),
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

    this.providerStatus = emptyProviderStatus;
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
    if (!this.providerStatus.isProviderConnected) {
      throw new Error("Provider not connected, cannot access interface");
    }
    if (!this.providerStatus.providerInterface) {
      throw new Error("Provider interface not present despite being connected. Possible logic bug");
    }
    if (!this.providerHandshake) {
      throw new Error("Provider connection not established, possible logic bug");
    }

    // TODO: This check doesn't work.
    // if (method in this.providerStatus.providerInterface) {
    //   throw new Error(
    //     `Unsupported method for this provider interface. Method: '${method}', Interface: ${this.providerStatus.providerInterface}`
    //   );
    // }

    const connection = await this.providerHandshake;
    return connection.remoteHandle().call("callInterface", method);
  }

  protected async disconnectProvider(): Promise<ProviderStatus> {
    await this.disconnect();
    this.setProviderDisconnected();
    return this.providerStatus;
  }

  protected async getBridgeMetadata(): Promise<BridgeMetadata> {
    return this.bridgeMetadata;
  }

  protected async getProviderStatus(): Promise<ProviderStatus> {
    return this.providerStatus;
  }

  /**
   * Tries to fetch the stored provider, silently trying to connect to it if one is found.
   */
  protected async fetchStoredProvider(skappInfo: SkappInfo): Promise<ProviderStatus> {
    // Check for stored provider.

    const providerMetadata = this.checkForStoredProvider();

    if (!providerMetadata) {
      this.setProviderUnloaded();
      return this.providerStatus;
    }

    // Launch the stored provider and try to connect to it without user input.

    // Ignore any caught error since we are in silent mode.
    try {
      const metadata = await this.launchProvider(providerMetadata.url);
      this.setProviderLoaded(metadata);
      this.saveStoredProvider();

      // Try to connect to stored provider.
      const providerInterface = await this.connectSilently(skappInfo);
      if (providerInterface) {
        this.setProviderConnected(providerInterface);
      }
    } catch(error) {
      this.setProviderUnloaded();
    }
    return this.providerStatus;
  }

  /**
   * Loads a new provider, as opposed to a stored one, by asking the user for it.
   */
  protected async loadNewProvider(skappInfo: SkappInfo): Promise<ProviderStatus> {
    // TODO: Add clean removal of old provider.

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
    this.saveStoredProvider();

    return this.providerStatus;
  }

  /**
   * Destroys the loaded provider and sets the state to unloaded.
   */
  protected async unloadProvider(): Promise<ProviderStatus> {
    if (!this.providerHandshake) {
      throw new Error("Provider connection not established, cannot unload a provider that was not loaded");
    }

    // Disconnect provider.
    if (this.providerStatus.isProviderConnected) {
      try {
        await this.disconnect();
      } catch (error) {
        // Provider errored while disconnecting. Log the error and move on.
        console.log(error);
      }
    }

    // Clear stored provider.
    this.providerStatus = emptyProviderStatus;
    this.clearStoredProvider();

    // Close the child iframe.
    if (this.childFrame) {
      this.childFrame.parentNode!.removeChild(this.childFrame);
    }

    // Close the connection.
    await this.providerHandshake.then((connection) => connection.close());

    // Unregister the connected info listener.
    if (this.connectionInfoListener) {
      window.removeEventListener("message", this.connectionInfoListener);
    }

    return this.providerStatus;
  }

  // =======================
  // Internal Provider Calls
  // =======================

  // TODO: Reject provider if it doesn't satisfy minimum interface.
  /**
   * Tries to connect to the provider, only connecting if the user is already logged in to the provider (as opposed to connectWithInput()).
   */
  protected async connectSilently(skappInfo: SkappInfo): Promise<Interface | null> {
    if (!this.providerHandshake) {
      throw new Error("Provider connection not established, possible logic bug");
    }

    const connection = await this.providerHandshake;
    return connection.remoteHandle().call("connectSilently", skappInfo);
  }

  protected async connectWithInput(receivedConnectedInfo: unknown): Promise<Interface> {
    if (!this.providerHandshake) {
      throw new Error("Provider connection not established, possible logic bug");
    }

    const connection = await this.providerHandshake;
    return connection.remoteHandle().call("connectWithInput", receivedConnectedInfo);
  }

  protected async disconnect(): Promise<void> {
    if (!this.providerHandshake) {
      throw new Error("Provider connection not established, possible logic bug");
    }

    const connection = await this.providerHandshake;
    return connection.remoteHandle().call("disconnect");
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

    providerUrl = ensureUrl(providerUrl);
    this.childFrame = createIframe(providerUrl, providerUrl);
    const childWindow = this.childFrame.contentWindow!;

    // Connect to the iframe.

    const messenger = new WindowMessenger({
      localWindow: window,
      remoteWindow: childWindow,
      remoteOrigin: "*",
    });
    this.providerHandshake = ParentHandshake(messenger, {}, handshakeMaxAttempts, handshakeAttemptsInterval);

    const parentConnection = await this.parentHandshake;
    const providerConnection = await this.providerHandshake;
    const remoteHandle = providerConnection.remoteHandle();

    // Register listener for connected info from the connector.

    const listener = async (event: MessageEvent) => {
      // Only consider messages from the provider domain.
      if (event.origin !== providerUrl)
        return;

      if (!event.data || event.data === "") {
        return;
      }

      // The message must be of type "connectionComplete".
      if (!event.data.messageType || event.data.messageType !== "connectionComplete") {
        return
      }

      // Finish connecting and get the interface.
      const receivedConnectedInfo = event.data.connectionInfo;
      const providerInterface = await this.connectWithInput(receivedConnectedInfo);

      // TODO: Reject provider if it doesn't satisfy minimum interface.
      if (providerInterface) {
        this.setProviderConnected(providerInterface);
      }

      // Send connectionComplete back up to the skapp.
      const localHandle = parentConnection.localHandle();
      localHandle.emit("connectionComplete", this.providerStatus);
    };
    window.addEventListener("message", listener);
    // @ts-expect-error TS is wrong here as far as I can tell.
    this.connectionInfoListener = listener;

    // Get the provider metadata.

    return remoteHandle.call("getMetadata");
  }

  protected setProviderConnected(providerInterface: Interface): void {
    this.providerStatus.isProviderConnected = true;
    this.providerStatus.providerInterface = providerInterface;
  }

  protected setProviderDisconnected(): void {
    this.providerStatus.isProviderConnected = false;
  }

  protected setProviderLoaded(metadata: ProviderMetadata): void {
    this.providerStatus.isProviderLoaded = true;
    this.providerStatus.metadata = metadata;
  }

  protected setProviderUnloaded(): void {
    this.providerStatus = emptyProviderStatus;
  }

  /**
   * Stores the current provider in the bridge's localStorage.
   */
  protected saveStoredProvider(): void {
    if (!localStorage) {
      console.log("WARNING: localStorage disabled");
      return;
    }

    localStorage.setItem(providerKey, JSON.stringify(this.providerStatus.metadata));
  }
}
