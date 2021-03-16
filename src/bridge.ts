import { ChildHandshake, ParentHandshake, WindowMessenger } from "post-me";
import type { Connection } from "post-me";
import {
  BridgeMetadata,
  createIframe,
  emitStorageEvent,
  ProviderMetadata,
  SkappInfo,
  listenForStorageEvent,
  monitorOtherListener,
  defaultWindowTimeout,
  defaultHandshakeMaxAttempts,
  defaultHandshakeAttemptsInterval,
} from "skynet-interface-utils";
import { CustomConnectOptions, SkynetClient } from "skynet-js";

type ProviderInfo = {
  connection: Connection;
  metadata: ProviderMetadata;
  childFrame: HTMLIFrameElement;
};

export class Bridge {
  public skappInfo?: SkappInfo;

  constructor(
    public bridgeMetadata: BridgeMetadata,

    protected client: SkynetClient,
    protected dacs: Map<string, ProviderInfo>,
    protected parentConnection: Connection
  ) {
    // Set child methods.

    const methods = {
      call: async (dacName: string, method: string, ...args: unknown[]) => this.call(dacName, method, args),
      // connectPopup: async (dacName: string) => this.connectPopup(dacName),
      // connectSilent: async (dacName: string) => this.connectSilent(dacName),
      // disconnect: async (dacName: string) => this.disconnect(dacName),
      getBridgeMetadata: async (skappInfo: SkappInfo) => this.getBridgeMetadata(skappInfo),
      loginPopup: async (dacName: string, opts: CustomConnectOptions) => this.loginPopup(dacName, opts),
      loginSilent: async (dacName: string) => this.loginSilent(dacName),
      logout: async (dacName: string) => this.logout(dacName),
    };
    this.parentConnection.localHandle().setMethods(methods);
  }

  static async initialize(bridgeMetadata: BridgeMetadata): Promise<Bridge> {
    if (typeof Storage == "undefined") {
      throw new Error("Browser does not support web storage");
    }

    // Enable communication with parent skapp.

    const messenger = new WindowMessenger({
      localWindow: window,
      remoteWindow: window.parent,
      remoteOrigin: "*",
    });
    // NOTE: We set the methods in the constructor since we don't have 'this' here.
    const parentConnection = await ChildHandshake(messenger);

    // Initialize an dac map.

    const dacs = new Map();

    // Initialize the Skynet client.

    const client = new SkynetClient();

    return new Bridge(bridgeMetadata, client, dacs, parentConnection);
  }

  // =================
  // Public Bridge API
  // =================

  protected async call(dacName: string, method: string, ...args: unknown[]): Promise<unknown> {
    const status = this.dacs.get(dacName);
    if (!status) {
      throw new Error(`Dac '${dacName}' not found`);
    }
    if (!status.metadata) {
      throw new Error("Provider not connected, cannot access dac");
    }

    return status.connection.remoteHandle().call("call", method, args);
  }

  protected async getBridgeMetadata(skappInfo: SkappInfo): Promise<BridgeMetadata> {
    this.skappInfo = skappInfo;
    return this.bridgeMetadata;
  }

  /**
   * Loads and connects to a new provider, as opposed to a stored one, by asking the user for it.
   *
   * 1. The tunnel has already launched the router and is now calling loginPopup() on the bridge.
   *
   * 2. The bridge waits for the provider URL from the router.
   *
   * 3. The bridge launches the provider and gets its metadata.
   *
   * 4. The bridge sends the provider metadata to the router.
   *
   * 5. The router opens the connector.
   *
   * 6. The bridge calls 'connectPopup()' on the provider and waits for the response.
   *
   * 7. The bridge stores the provider for future logins.
   *
   * @param dacName
   * @param _opts
   */
  protected async loginPopup(dacName: string, _opts: CustomConnectOptions): Promise<void> {
    // Event listener that waits for provider url from the router.
    const { promise: promiseProviderUrl, controller: controllerProviderUrl } = listenForStorageEvent(
      "router-provider-url"
    );
    // Kick off another event listener along with the first one as the router window may still be closed or an error may occur, and we need to handle that.
    const { promise: promiseLong, controller: controllerLong } = listenForStorageEvent("router");
    // Start the router pinger.
    const { promise: promisePing, controller: controllerPing } = monitorOtherListener(
      "bridge",
      "router",
      defaultWindowTimeout
    );

    // eslint-disable-next-line no-async-promise-executor
    const promise: Promise<void> = new Promise(async (resolve, reject) => {
      // Make this promise run in the background and reject on window close or any errors.
      promiseLong.catch((err: string) => {
        // Don't emit an error to the router, it should close on its own on error.
        reject(err);
      });
      promisePing.catch(() => {
        reject("Router timed out");
      });

      let receivedProviderUrl;
      let info;
      try {
        // Do initial validation.

        if (!this.skappInfo) {
          throw new Error("getBridgeMetadata() with skappInfo was not called");
        }
        if (this.dacs.get(dacName)) {
          throw new Error(`Dac '${dacName}' already loaded`);
        }

        // Wait for provider URL from router.

        receivedProviderUrl = await promiseProviderUrl;

        // Launch the provider.

        // Format the provider URL.
        const providerUrl = this.formatProviderUrl(receivedProviderUrl);
        info = await this.launchProvider(providerUrl);

        // Send the metadata to the router.

        const value = JSON.stringify(info.metadata);
        emitStorageEvent("bridge-metadata", "success", value);
      } catch (err) {
        // Send an error to the router before throwing.
        emitStorageEvent("bridge", "error", err);
        reject(err);
        return;
      }

      try {
        // Try to connect to given provider.

        // Cancel the router pinger. The provider will be in charge of pinging the connector from now on.
        controllerPing.cleanup();

        await info.connection.remoteHandle().call("connectPopup", this.skappInfo);
        this.setProviderConnected(dacName, info);
        this.saveStoredProvider(dacName, info.metadata);
      } catch (err) {
        reject(new Error(`Could not login with user input: ${err}`));
        return;
      }

      resolve();
    });

    return promise
      .catch((err) => {
        // TODO: Unload provider if launched
        throw err;
      })
      .finally(() => {
        // Clean up the event listeners and promises.
        controllerProviderUrl.cleanup();
        controllerLong.cleanup();
        controllerPing.cleanup();
      });
  }

  /**
   * Tries to fetch the stored provider, silently trying to connect to it if one is found.
   *
   * 1. The bridge checks if a provider has been stored.
   *
   * 2. If a provider is found, the bridge launches it.
   *
   * 3. The bridge then calls connectSilent() on the provider.
   *
   * 4. If everything succeeded, the bridge links the provider to the given dac name in its dac map.
   *
   * @param dacName
   */
  protected async loginSilent(dacName: string): Promise<void> {
    if (this.dacs.get(dacName)) {
      throw new Error(`Dac '${dacName}' already loaded`);
    }

    // Check for stored provider.

    const providerMetadata = this.checkForStoredProvider(dacName);
    if (!providerMetadata) {
      throw new Error(`Stored provider for dac '${dacName}' not found`);
    }

    // Launch the stored provider.

    const info = await this.launchProvider(providerMetadata.info.domain);

    // Try to connect without user input.

    try {
      // TODO: Check that returned schema is valid.

      // Try to connect to stored provider.

      await info.connection.remoteHandle().call("connectSilent", this.skappInfo);
      this.setProviderConnected(dacName, info);
    } catch (error) {
      // TODO: Unload provider if launched.
      throw new Error("Could not login silently");
    }
  }

  /**
   * Logs out and destroys the loaded provider.
   *
   * @param dacName
   */
  protected async logout(dacName: string): Promise<void> {
    const i = this.dacs.get(dacName);
    if (!i) {
      throw new Error(`Dac '${dacName}' already loaded`);
    }

    // Disconnect provider.

    try {
      await i.connection.remoteHandle().call("disconnect");
    } catch (error) {
      // Provider errored while disconnecting. Log the error and move on.
      console.log(error);
    }
    this.setProviderDisconnected(dacName);

    // Clear stored provider.

    this.clearStoredProvider(dacName);

    // Close the child iframe.

    i.childFrame.parentNode!.removeChild(i.childFrame);

    // Close the connection.
    i.connection.close();
  }

  // =======================
  // Internal Bridge Methods
  // =======================

  /**
   * Checks for provider stored in the bridge's local storage.
   *
   * @param dacName
   * @returns - The provider metadata including URL and name, or null if not found.
   */
  protected checkForStoredProvider(dacName: string): ProviderMetadata | null {
    if (!localStorage) {
      console.log("WARNING: localStorage disabled");
      return null;
    }

    const metadata = localStorage.getItem(this.dacStorageKey(dacName));
    if (!metadata) {
      return null;
    }
    const result: ProviderMetadata = JSON.parse(metadata);
    return result;
  }

  protected clearStoredProvider(dacName: string): void {
    if (!localStorage) {
      console.log("WARNING: localStorage disabled");
      return;
    }

    localStorage.removeItem(this.dacStorageKey(dacName));
  }

  protected formatProviderUrl(providerUrl: string): string {
    // Get base32 skylink.
    providerUrl = this.client.getSkylinkUrl(providerUrl, { subdomain: true });
    // TODO: This is necessary because getSkylinkUrl() currently prepends the base32 skylink to the existing subdomain instead of replacing it. Remove once getSkylinkUrl() is fixed.
    const providerUrlArr = providerUrl.split(".");
    providerUrlArr.splice(1, 1);
    providerUrl = providerUrlArr.join(".");
    return providerUrl;
  }

  protected dacStorageKey(dacName: string): string {
    return `dac:${dacName}`;
  }

  /**
   * Launches the iframe with the provider and establishes a connection.
   *
   * @param providerUrl
   */
  protected async launchProvider(providerUrl: string): Promise<ProviderInfo> {
    // TODO: Check for valid base32 providerUrl here.

    // Create the iframe.

    const childFrame = createIframe(providerUrl, providerUrl);
    const childWindow = childFrame.contentWindow!;

    // Connect to the iframe.

    const messenger = new WindowMessenger({
      localWindow: window,
      remoteWindow: childWindow,
      remoteOrigin: "*",
    });
    // TODO: Get handshake values from optional fields.
    const connection = await ParentHandshake(
      messenger,
      {},
      defaultHandshakeMaxAttempts,
      defaultHandshakeAttemptsInterval
    );

    const metadata = await connection.remoteHandle().call("getProviderMetadata");

    return { connection, metadata, childFrame };
  }

  protected setProviderConnected(dacName: string, info: ProviderInfo): void {
    this.dacs.set(dacName, info);
  }

  protected setProviderDisconnected(dacName: string): void {
    this.dacs.delete(dacName);
  }

  /**
   * Stores the current provider in the bridge's localStorage.
   *
   * @param dacName
   * @param providerMetadata
   */
  protected saveStoredProvider(dacName: string, providerMetadata: ProviderMetadata): void {
    if (!localStorage) {
      console.log("WARNING: localStorage disabled, provider not stored");
      return;
    }

    localStorage.setItem(this.dacStorageKey(dacName), JSON.stringify(providerMetadata));
  }
}
