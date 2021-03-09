import { ChildHandshake, ParentHandshake, WindowMessenger } from "post-me";
import type { Connection } from "post-me";
import { BridgeMetadata, createIframe, ProviderMetadata, SkappInfo } from "skynet-interface-utils";
import { SkynetClient } from "skynet-js";

import { handshakeAttemptsInterval, handshakeMaxAttempts } from "./consts";

type ProviderInfo = {
  connection: Connection,
  metadata: ProviderMetadata;
  childFrame: HTMLIFrameElement;
};

export class Bridge {
  public skappInfo?: SkappInfo;

  constructor(
    public bridgeMetadata: BridgeMetadata,

    protected client: SkynetClient,
    protected interfaces: Map<string, ProviderInfo>,
    protected parentConnection: Connection,
  ) {
    // Set child methods.

    const methods = {
      callInterface: async (interfaceName: string, method: string, ...args: unknown[]) => this.callInterface(interfaceName, method, args),
      getBridgeMetadata: async (skappInfo: SkappInfo) => this.getBridgeMetadata(skappInfo),
      loginPopup: async (interfaceName: string) => this.loginPopup(interfaceName),
      loginSilent: async (interfaceName: string) => this.loginSilent(interfaceName),
      logout: async (interfaceName: string) => this.logout(interfaceName),
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
    const parentConnection =  await ChildHandshake(messenger);

    // Initialize an interface map.

    const interfaces = new Map();

    // Initialize the Skynet client.

    const client = new SkynetClient();

    return new Bridge(bridgeMetadata, client, interfaces, parentConnection);
  }

  // =================
  // Public Bridge API
  // =================

  protected async callInterface(interfaceName: string, method: string, ...args: unknown[]): Promise<unknown> {
    const status = this.interfaces.get(interfaceName);
    if (!status) {
      throw new Error(`Interface '${interfaceName}' not found`);
    }
    if (!status.metadata) {
      throw new Error("Provider not connected, cannot access interface");
    }

    // TODO: This check doesn't work.
    // if (method in this.providerStatus.providerInterface) {
    //   throw new Error(
    //     `Unsupported method for this provider interface. Method: '${method}', Interface: ${this.providerStatus.providerInterface}`
    //   );
    // }

    return status.connection.remoteHandle().call("callInterface", method, args);
  }

  protected async getBridgeMetadata(skappInfo: SkappInfo): Promise<BridgeMetadata> {
    this.skappInfo = skappInfo;
    return this.bridgeMetadata;
  }

  /**
   * Loads and connects to a new provider, as opposed to a stored one, by asking the user for it.
   *
   * 1. The gate has already launched the router and is now calling loginPopup() on the bridge.
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
   */
  protected async loginPopup(interfaceName: string): Promise<void> {
    if (!this.skappInfo) {
      throw new Error("getBridgeMetadata() with skappInfo was not called");
    }
    if (this.interfaces.get(interfaceName)) {
      throw new Error(`Interface '${interfaceName}' already loaded`);
    }

    // Wait for provider URL from the router.

    const receivedProviderUrl: string = await new Promise((resolve, reject) => {
      const handleEvent = ({ key, newValue }: StorageEvent) => {
        if (!key) {
          reject("Storage event data not found");
          return;
        }

        if (!["success-router", "event-router", "error-router"].includes(key)) {
          return;
        }
        window.removeEventListener("storage", handleEvent);
        window.localStorage.removeItem(key);

        if (key === "success-router") {
          if (!newValue) {
            reject("Storage event data value not found");
            return;
          }
          resolve(newValue);
        } else if (key === "event-router") {
          reject("Window was closed");
        } else {
          // Key should be 'error'.
          if (key !== "error-router") {
            reject("Unknown key received");
          }
          reject(newValue);
        }
      };

      window.addEventListener("storage", handleEvent);
    });
    // TODO: Kick off another event listener right away as the router window may still be closed or an error may occur.

    // Format the provider URL.
    const providerUrl = this.formatProviderUrl(receivedProviderUrl);

    // Launch the provider.

    let info;
    try {
      info = await this.launchProvider(providerUrl);
    } catch (err) {
      // Send an error to the router.
      window.localStorage.setItem("error-bridge", err);
      throw err;
    }

    // Send the metadata to the router.

    const key = "success-bridge"
    const value = JSON.stringify(info.metadata);
    window.localStorage.setItem(key, value);

    try {
      // Try to connect to given provider.

      await info.connection.remoteHandle().call("connectPopup", this.skappInfo);
      this.setProviderConnected(interfaceName, info);
      this.saveStoredProvider(interfaceName, info.metadata);
    } catch (error) {
      // TODO: Unload provider if launched
      throw new Error(`Could not login with user input: ${error}`);
    }
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
   * 4. If everything succeeded, the bridge links the provider to the given interface name in its interface map.
   */
  protected async loginSilent(interfaceName: string): Promise<void> {
    if (this.interfaces.get(interfaceName)) {
      throw new Error(`Interface '${interfaceName}' already loaded`);
    }

    // Check for stored provider.

    const providerMetadata = this.checkForStoredProvider(interfaceName);
    if (!providerMetadata) {
      throw new Error(`Stored provider for interface '${interfaceName}' not found`);
    }

    // Launch the stored provider.

    const info = await this.launchProvider(providerMetadata.url);

    // Try to connect without user input.

    try {
      // TODO: Check that returned schema is valid.

      // Try to connect to stored provider.

      await info.connection.remoteHandle().call("connectSilent", this.skappInfo);
      this.setProviderConnected(interfaceName, info);
    } catch (error) {
      // TODO: Unload provider if launched.
      throw new Error("Could not login silently");
    }
  }

  /**
   * Logs out and destroys the loaded provider.
   */
  protected async logout(interfaceName: string): Promise<void> {
    const i = this.interfaces.get(interfaceName);
    if (!i) {
      throw new Error(`Interface '${interfaceName}' already loaded`);
    }

    // Disconnect provider.

    try {
      await i.connection.remoteHandle().call("disconnect");
    } catch (error) {
      // Provider errored while disconnecting. Log the error and move on.
      console.log(error);
    }
    this.setProviderDisconnected(interfaceName);

    // Clear stored provider.

    this.clearStoredProvider(interfaceName);

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
   * @returns - The provider metadata including URL and name.
   */
  protected checkForStoredProvider(interfaceName: string): ProviderMetadata | null {
    if (!localStorage) {
      console.log("WARNING: localStorage disabled");
      return null;
    }

    const metadata = localStorage.getItem(this.interfaceStorageKey(interfaceName));
    if (!metadata) {
      return null;
    }
    const result: ProviderMetadata = JSON.parse(metadata);
    return result;
  }

  protected clearStoredProvider(interfaceName: string): void {
    if (!localStorage) {
      console.log("WARNING: localStorage disabled");
      return;
    }

    localStorage.removeItem(this.interfaceStorageKey(interfaceName));
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

  protected interfaceStorageKey(interfaceName: string): string {
    return `interface:${interfaceName}`;
  }

  /**
   * Launches the iframe with the provider and establishes a connection.
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
    const connection = await ParentHandshake(messenger, {}, handshakeMaxAttempts, handshakeAttemptsInterval);

    const metadata = await connection.remoteHandle().call("getProviderMetadata");

    return { connection, metadata, childFrame };
  }

  protected setProviderConnected(interfaceName: string, info: ProviderInfo): void {
    this.interfaces.set(interfaceName, info);
  }

  protected setProviderDisconnected(interfaceName: string): void {
    this.interfaces.delete(interfaceName);
  }

  /**
   * Stores the current provider in the bridge's localStorage.
   */
  protected saveStoredProvider(interfaceName: string, providerMetadata: ProviderMetadata): void {
    if (!localStorage) {
      console.log("WARNING: localStorage disabled, provider not stored");
      return;
    }

    localStorage.setItem(this.interfaceStorageKey(interfaceName), JSON.stringify(providerMetadata));
  }
}
