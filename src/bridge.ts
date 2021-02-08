import { connectToChild, connectToParent } from "penpal";
import { Connection, CallSender } from "penpal/lib/types";

import { createIframe } from "./utils";

type Interface = Record<string, Array<string>>;

class SkappInfo {
  name: string;
  url: string;
}

type ProviderInfo = {
  providerInterface: Interface;
  isProviderConnected: boolean;
  isProviderLoaded: boolean;
  metadata: ProviderMetadata;
};

type ProviderMetadata = {
  name: string;
  url: string;
};

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
  }

  // =================
  // Public Bridge API
  // =================

  protected async callInterface(method: string) {
    if (!this.providerInfo.isProviderConnected) {
      throw new Error("Provider not connected, cannot access interface");
    }

    if (method in this.providerInfo.providerInterface) {
      return this.providerConnection.promise.then(async (child: CallSender) => child[method]());
    } else {
      throw new Error(
        `Unsupported method for this provider interface. Method: '${method}', Interface: ${this.providerInfo.providerInterface}`
      );
    }
  }

  protected async connectProvider(): Promise<ProviderInfo> {
    return this.connect()
      .then((providerInterface) => {
        this.providerInfo.isProviderConnected = true;
        this.providerInfo.providerInterface = providerInterface;
      })
      .catch(() => {
        this.providerInfo.isProviderConnected = false;
      })
      .then(() => {
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

    const providerUrl = this.checkForStoredProvider();

    if (!providerUrl) {
      this.setProviderUnloaded();
      return this.providerInfo;
    }

    // Launch the stored provider and try to load it.

    return this.launchProvider(providerUrl)
      .then(async () => {
        this.providerInfo.isProviderLoaded = true;

        // Try to connect to stored provider.
        return this.load()
          .then((providerInterface) => {
            this.providerInfo.isProviderConnected = true;
            this.providerInfo.providerInterface = providerInterface;
          })
          .catch(() => {
            this.providerInfo.isProviderConnected = false;
          });
      })
      .catch(() => this.setProviderUnloaded())
      .then(() => {
        return this.providerInfo;
      });
  }

  // Launch the iframe with the provider and establish a connection.
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
      .then(() => (this.providerInfo.isProviderLoaded = true))
      .then(async () =>
        this.connect()
          .then((providerInterface: Interface) => {
            this.providerInfo.isProviderConnected = true;
            this.providerInfo.providerInterface = providerInterface;
          })
          .catch(() => {
            this.providerInfo.isProviderConnected = false;
          })
      )
      .catch(() => {
        // Don't change anything here. On error we should retain the previous state.
      })
      .then(() => {
        return this.providerInfo;
      });
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
   * Tries to connect to the provider, connecting even if the user isn't already logged in to the provider (as opposed to load()).
   */
  protected async connect(): Promise<[Interface, ProviderMetadata]> {
    return this.providerConnection.promise.then(async (child) => child.connect(this.skappInfo));
  }

  protected async disconnect(): Promise<void> {
    return this.providerConnection.promise.then(async (child) => child.disconnect());
  }

  /**
   * Tries to load the provider, only connecting if the user is already logged in to that provider (as opposed to connect()).
   */
  protected async load(): Promise<[Interface, ProviderMetadata]> {
    // Call load() on the provider with the skapp info.
    return this.providerConnection.promise.then(async (child) => child.load(this.skappInfo));
  }

  // =======================
  // Internal Bridge Methods
  // =======================

  // TODO
  /**
   * Checks for provider stored in local storage for this bridge's origin.
   * @returns - The provider metadata including URL and name.
   */
  protected checkForStoredProvider(): ProviderMetadata | null {
    throw new Error("unimplemented");
  }

  // TODO
  /**
   * Create iframe with router.
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

      // Set the identity we received.
      this.setIdentity("tester");
    });
  }

  protected setProviderUnloaded(): void {
    this.providerInfo.isProviderLoaded = false;
    this.providerInfo.isProviderConnected = false;
  }
}
