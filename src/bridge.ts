import { connectToChild, connectToParent } from "penpal";
import { Connection, CallSender } from "penpal/lib/types";

import { createIframe, popupCenter } from "./utils";

export type Interface = Record<string, Array<string>>;

const providerKey = "provider";
const routerName = "Identity Router";
const [routerW, routerH] = [400, 500];

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
  minimumInterface: Interface;
  providerInfo: ProviderInfo;

  protected parentConnection: Connection;
  protected providerConnection: Connection | null;

  constructor(minimumInterface: Interface) {
    // Set the interface.

    this.minimumInterface = minimumInterface;

    // Enable communication with parent skapp.

    const connection = connectToParent({
      methods: {
        callInterface: (method: string) => this.callInterface(method),
        connectProvider: (skappInfo: SkappInfo) => this.connectProvider(skappInfo),
        disconnectProvider: () => this.disconnectProvider(),
        fetchStoredProvider: (skappInfo: SkappInfo) => this.fetchStoredProvider(skappInfo),
        getProviderInfo: () => this.getProviderInfo(),
        loadNewProvider: (skappInfo: SkappInfo) => this.loadNewProvider(skappInfo),
        unloadProvider: () => this.unloadProvider(),
      },
      timeout: 5_000,
    });
    this.parentConnection = connection;

    // Initialize an empty provider info.

    this.providerInfo = emptyProviderInfo;
    this.providerConnection = null;
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
    if (!this.providerConnection) {
      throw new Error("provider connection not established, possible logic bug");
    }

    if (method in this.providerInfo.providerInterface) {
      return this.providerConnection.promise.then(async (child: CallSender) => child.callInterface(method));
    } else {
      throw new Error(
        `Unsupported method for this provider interface. Method: '${method}', Interface: ${this.providerInfo.providerInterface}`
      );
    }
  }

  protected async connectProvider(skappInfo: SkappInfo): Promise<ProviderInfo> {
    return this.connectWithInput(skappInfo)
      .then((providerInterface) => {
        this.providerInfo.isProviderConnected = true;
        this.providerInfo.providerInterface = providerInterface;
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

  protected async fetchStoredProvider(skappInfo: SkappInfo): Promise<ProviderInfo> {
    // Check for stored provider.

    const providerMetadata = this.checkForStoredProvider();

    if (!providerMetadata) {
      this.setProviderUnloaded();
      return this.providerInfo;
    }

    // Launch the stored provider and try to connect to it without user input.

    return this.launchProvider(providerMetadata.domain)
      .then(async (metadata) => {
        this.providerInfo.isProviderLoaded = true;
        this.providerInfo.metadata = metadata;

        // Try to connect to stored provider.
        return this.connectSilently(skappInfo)
          .then((providerInterface) => {
            this.providerInfo.isProviderConnected = true;
            this.providerInfo.providerInterface = providerInterface;
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
  protected async loadNewProvider(skappInfo: SkappInfo): Promise<ProviderInfo> {
    // TODO: Add clean removal of old provider.

    // Launch router.
    return this.launchRouter()
      .then(async (providerUrl: string) =>
        // Launch the provider.
        this.launchProvider(providerUrl)
           )
      .then(async (metadata) => {
        this.providerInfo.isProviderLoaded;
        this.providerInfo.metadata = metadata;

        return this.connectWithInput(skappInfo)
          .then((providerInterface) => {
            this.providerInfo.isProviderConnected = true;
            this.providerInfo.providerInterface = providerInterface;
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

  // TODO: Reject provider if it doesn't satisfy minimum interface.
  /**
   * Tries to connect to the provider, connecting even if the user isn't already logged in to the provider (as opposed to connectSilently()).
   */
  protected async connectWithInput(skappInfo: SkappInfo): Promise<Interface> {
    if (!this.providerConnection) {
      throw new Error("provider connection not established, possible logic bug");
    }

    return this.providerConnection.promise.then(async (child) => child.connectWithInput(skappInfo));
  }

  protected async disconnect(): Promise<void> {
    if (!this.providerConnection) {
      throw new Error("provider connection not established, possible logic bug");
    }

    return this.providerConnection.promise.then(async (child) => child.disconnect());
  }

  // TODO: Reject provider if it doesn't satisfy minimum interface.
  /**
   * Tries to connect to the provider, only connecting if the user is already logged in to the provider (as opposed to connectWithInput()).
   */
  protected async connectSilently(skappInfo: SkappInfo): Promise<Interface> {
    if (!this.providerConnection) {
      throw new Error("provider connection not established, possible logic bug");
    }

    return this.providerConnection.promise.then(async (child) => child.connectSilently(skappInfo));
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

  /**
   * Launches the iframe with the provider and establish a connection.
   */
  protected async launchProvider(providerUrl: string): Promise<ProviderMetadata> {
    // TODO: Duplicate check for valid providerUrl here.

    // Create the iframe.
    const childFrame = createIframe(providerUrl);

    // Connect to the iframe.
    const connection = connectToChild({
      iframe: childFrame,
      timeout: 5_000,
    });

    this.providerConnection = connection;

    return this.providerConnection.promise.then(async (child) => child.getMetadata());
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

        alert(event.data);

        window.removeEventListener("message", handleMessage);

        // Resolve or reject the promise.
        if (event.data === "") {
          reject(new Error("did not get a provider URL"));
        }
        // TODO: Check for valid base32 skylink.
        resolve(event.data);
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
  protected storeProvider(): void {
    localStorage.setItem(providerKey, JSON.stringify(this.providerInfo.metadata));
  }
}
