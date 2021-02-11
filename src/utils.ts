/**
 * Creates an invisible iframe with the given src and adds it to the page.
 */
export function createIframe(srcUrl: string) {
  if (!srcUrl.startsWith("https://")) {
    srcUrl = `https://${srcUrl}`;
  }

  const childFrame = document.createElement("iframe")!;
  childFrame.src = srcUrl;
  childFrame.style.display = "none";
  // Add the frame to the page.
  if (document.readyState === "complete" || document.readyState === "interactive") {
    document.body.appendChild(childFrame);
  } else {
    document.addEventListener("DOMContentLoaded", () => {
      document.body.appendChild(childFrame);
    });
  }

  return childFrame;
}

/**
 * From SkyID.
 */
export function popupCenter(url: string, title: string, w: number, h: number): Window {
  // Fixes dual-screen position                             Most browsers      Firefox
  const dualScreenLeft = window.screenLeft !== undefined ? window.screenLeft : window.screenX
  const dualScreenTop = window.screenTop !== undefined ? window.screenTop : window.screenY

  const width = window.innerWidth ? window.innerWidth : document.documentElement.clientWidth ? document.documentElement.clientWidth : screen.width
  const height = window.innerHeight ? window.innerHeight : document.documentElement.clientHeight ? document.documentElement.clientHeight : screen.height

  const systemZoom = width / window.screen.availWidth
  const left = (width - w) / 2 / systemZoom + dualScreenLeft
  const top = (height - h) / 2 / systemZoom + dualScreenTop
  const newWindow = window.open(url, title,
                                `
scrollbars=yes,
width=${w / systemZoom},
height=${h / systemZoom},
top=${top},
left=${left}
`
                               )
  if (!newWindow) {
    throw new Error("could not open window");
  }

  if (newWindow.focus) newWindow.focus();
  return newWindow;
}
