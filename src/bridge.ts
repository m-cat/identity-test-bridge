import { connectToChild, connectToParent } from "penpal";
import { Connection, CallSender } from "penpal/lib/types";

import { createIframe } from "./utils";

export type Interface = Record<string, Array<string>>;

const providerKey = "provider";

type ProviderInfo = {
  providerInterface: Interface | null;
  isProviderConnected: boolean;
  isProviderLoaded: boolean;
  metadata: ProviderMetadata | null;
};

type ProviderMetadata = {
  name: string;
  domain: string;
};

class SkappInfo {
  name: string;
  domain: string;
}

export class Bridge {
  parentConnection: Connection;
  providerConnection: Connection;

  minimumInterface: Interface;
  skappInfo: SkappInfo;
  providerInfo: ProviderInfo;

  constructor(minimumInterface: Interface) {
    // Set the interface.

    this.minimumInterface = minimumInterface;

    // Enable communication with parent skapp.

    const connection = connectToParent({
      methods: {
        callInterface: this.callInterface,
        connectProvider: this.connectProvider,
        disconnectProvider: this.disconnectProvider,
        fetchStoredProvider: this.fetchStoredProvider,
        getProviderInfo: this.getProviderInfo,
        loadNewProvider: this.loadNewProvider,
        setSkappInfo: this.setSkappInfo,
        unloadProvider: this.unloadProvider,
      },
      timeout: 5_000,
    });
    this.parentConnection = connection;

    // Initialize an empty provider info.

    this.providerInfo = {
      providerInterface: null,
      isProviderConnected: false,
      isProviderLoaded: false,
      metadata: null,
    }
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

    if (method in this.providerInfo.providerInterface) {
      return this.providerConnection.promise.then(async (child: CallSender) => child.callInterface(method));
    } else {
      throw new Error(
        `Unsupported method for this provider interface. Method: '${method}', Interface: ${this.providerInfo.providerInterface}`
      );
    }
  }

  protected async connectProvider(): Promise<ProviderInfo> {
    return this.connectWithInput()
      .then(([providerInterface, metadata]) => {
        this.providerInfo.isProviderConnected = true;
        this.providerInfo.providerInterface = providerInterface;
        this.providerInfo.metadata = metadata;
      })
      .catch(() => {
        this.providerInfo.isProviderConnected = false;
      })
      .then(() => {
        this.storeProvider();
        return this.providerInfo;
      });
  }

  protected async disconnectProvider(): Promise<ProviderInfo> {
    return this.disconnect().then(() => {
      this.providerInfo.isProviderConnected = false;
      return this.providerInfo;
    });
  }

  protected async getProviderInfo(): Promise<ProviderInfo> {
    return this.providerInfo;
  }

  protected async fetchStoredProvider(): Promise<ProviderInfo> {
    // Check for stored provider.

    const providerMetadata = this.checkForStoredProvider();

    if (!providerMetadata) {
      this.setProviderUnloaded();
      return this.providerInfo;
    }

    // Launch the stored provider and try to load it.

    return this.launchProvider(providerMetadata.domain)
      .then(async () => {
        this.providerInfo.isProviderLoaded = true;

        // Try to connect to stored provider.
        return this.connectSilently()
          .then(([providerInterface, metadata]) => {
            this.providerInfo.isProviderConnected = true;
            this.providerInfo.providerInterface = providerInterface;
            this.providerInfo.metadata = metadata;
          })
          .catch(() => {
            this.providerInfo.isProviderConnected = false;
          })
          .then(() => {
            this.storeProvider();
          });
      })
      .catch(() => this.setProviderUnloaded())
      .then(() => {
        return this.providerInfo;
      });
  }

  /**
   * Loads a new provider, as opposed to a stored one, by asking the user for it.
   */
  protected async loadNewProvider(): Promise<ProviderInfo> {
    // TODO: Add clean removal of old provider.

    // Launch router.
    return this.launchRouter()
      .then(async (providerUrl: string) =>
        // Launch the provider.
        this.launchProvider(providerUrl)
      )
      .then(async () => {
        this.providerInfo.isProviderLoaded;

        return this.connectWithInput()
          .then(([providerInterface, metadata]) => {
            this.providerInfo.isProviderConnected = true;
            this.providerInfo.providerInterface = providerInterface;
            this.providerInfo.metadata = metadata;
          })
          .catch(() => {
            this.providerInfo.isProviderConnected = false;
          })
          .then(() => {
            this.storeProvider();
          });
      })
      .catch(() => {
        // Don't change anything here. On error we should retain the previous state.
      })
      .then(() => {
        return this.providerInfo;
      });
  }

  protected async setSkappInfo(skappInfo: SkappInfo): Promise<void> {
    this.skappInfo = skappInfo;
  }

  // TODO: There's currently no flow for this.
  /**
   * Destroys the loaded provider and sets the state to unloaded.
   */
  protected unloadProvider(): Promise<void> {
    throw new Error("unimplemented");
  }

  // =======================
  // Internal Provider Calls
  // =======================

  /**
   * Tries to connect to the provider, connecting even if the user isn't already logged in to the provider (as opposed to connectSilently()).
   */
  protected async connectWithInput(): Promise<[Interface, ProviderMetadata]> {
    return this.providerConnection.promise.then(async (child) => child.connectWithInput(this.skappInfo));
  }

  protected async disconnect(): Promise<void> {
    return this.providerConnection.promise.then(async (child) => child.disconnect());
  }

  /**
   * Tries to connect to the provider, only connecting if the user is already logged in to the provider (as opposed to connectWithInput()).
   */
  protected async connectSilently(): Promise<[Interface, ProviderMetadata]> {
    return this.providerConnection.promise.then(async (child) => child.connectSilently(this.skappInfo));
  }

  // =======================
  // Internal Bridge Methods
  // =======================

  // TODO
  /**
   * Checks for provider stored in the bridge's local storage.
   * @returns - The provider metadata including URL and name.
   */
  protected checkForStoredProvider(): ProviderMetadata | null {
    const metadata = localStorage.getItem(providerKey);
    if (!metadata) {
      return null;
    }
    return JSON.parse(metadata);
  }

  /**
   * Launches the iframe with the provider and establish a connection.
   */
  protected async launchProvider(providerUrl: string): Promise<void> {
    // Create the iframe.
    const childFrame = createIframe(providerUrl);

    // Connect to the iframe.
    const connection = connectToChild({
      iframe: childFrame,
      timeout: 5_000,
    });

    this.providerConnection = connection;
  }

  // TODO
  /**
   * Creates iframe with router.
   */
  protected async launchRouter(): Promise<string> {
    // TODO: Should this open a window instead?
    const iframe = document.createElement("iframe");
    iframe.style.display = "none";
    iframe.sandbox = "allow-scripts";
    iframe.setAttribute(
      "srcdoc",
      `<html><body>
<script>
runRouter();
</script>
</body></html>`
    );
    const origin = new URL(iframe.src).origin;

    // Add iframe to the skapp.
    document.body.appendChild(iframe);

    // Listen for completion message from child frame.
    // TODO: Prevent receiving from router window here?
    window.addEventListener("message", (event) => {
      if (event.origin !== origin) {
        return;
      }

      // Destroy the iframe.
      iframe.parentNode.removeChild(iframe);
    });
  }

  protected setProviderUnloaded(): void {
    this.providerInfo.isProviderLoaded = false;
    this.providerInfo.isProviderConnected = false;
  }

  /**
   * Stores the current provider in the bridge's localStorage.
   */
  protected storeProvider(): void {
    localStorage.setItem(providerKey, JSON.stringify(this.providerInfo.metadata));
  }
}
