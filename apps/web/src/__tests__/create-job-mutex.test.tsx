import { render, fireEvent, waitFor } from "@testing-library/react";
import { CreateJobForm } from "../app/page";

beforeEach(() => {
  (window as any).ethereum = { request: jest.fn() };
});

afterEach(() => {
  delete (window as any).ethereum;
});

it("fires eth_sendTransaction exactly once on rapid double-click", async () => {
  const mockRequest = jest.fn().mockResolvedValue("0xabc123");
  (window as any).ethereum = { request: mockRequest };

  const { getByRole } = render(<CreateJobForm />);
  const button = getByRole("button", { name: /create job/i });

  fireEvent.click(button);
  fireEvent.click(button);
  fireEvent.click(button);

  await waitFor(() => expect(mockRequest).toHaveBeenCalledTimes(1));
});

it("button is disabled while submission is in flight", async () => {
  let resolveRequest: (v: string) => void;
  const slowRequest = new Promise<string>((res) => { resolveRequest = res; });
  (window as any).ethereum = { request: jest.fn().mockReturnValue(slowRequest) };

  const { getByRole } = render(<CreateJobForm />);
  const button = getByRole("button", { name: /create job/i });

  fireEvent.click(button);
  expect(button).toBeDisabled();

  resolveRequest!("0xdef456");
  await waitFor(() => expect(button).not.toBeDisabled());
});
