import { render, unmountComponentAtNode } from "react-dom";
import { act } from "react-dom/test-utils";
import { Providers } from "../app/providers";

let container: HTMLDivElement | null = null;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  (window as any).ethereum = {
    on: jest.fn(),
    removeListener: jest.fn(),
    request: jest.fn(),
    setMaxListeners: jest.fn(),
  };
});

afterEach(() => {
  if (container) {
    document.body.removeChild(container);
    container = null;
  }
  delete (window as any).ethereum;
});

it("does not accumulate listeners across mount/unmount cycles", () => {
  const mockEthereum = (window as any).ethereum;

  for (let i = 0; i < 5; i++) {
    act(() => {
      render(<Providers><div /></Providers>, container!);
    });
    act(() => {
      unmountComponentAtNode(container!);
    });
  }

  const onCalls = mockEthereum.on.mock.calls.length;
  const removeCalls = mockEthereum.removeListener.mock.calls.length;

  expect(removeCalls).toBe(onCalls);
});
