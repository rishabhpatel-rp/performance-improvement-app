/* eslint-disable @typescript-eslint/no-explicit-any */
import "react";

declare global {
  namespace React {
    namespace JSX {
      interface IntrinsicElements {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        [key: `s-${string}`]: any;
      }
    }
  }
}

export {};
