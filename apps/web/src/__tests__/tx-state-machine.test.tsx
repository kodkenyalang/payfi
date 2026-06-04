import { render, fireEvent, waitFor } from "@testing-library/react";
import { CreateJobForm } from "../app/page";

beforeEach(() => {
  (window as any).ethereum = { request: jest.fn() };
});

afterEach(() => {
  delete (window as any).ethereum;
});

it("shows Job Created only after tx hash is returned", async () => {
  const mockRequest = jest.fn().mockResolvedValue("0xabc123hash");
  (window as any).ethereum = { request: mockRequest };

  const { getByRole, queryByText } = render(<CreateJobForm />);
  expect(queryByText(/job created/i)).toBeNull();

  fireEvent.click(getByRole("button", { name: /create job/i }));
  await waitFor(() => expect(queryByText(/job created/i)).toBeInTheDocument());
});

it("shows Try Again on transaction failure", async () => {
  (window as any).ethereum = {
    request: jest.fn().mockRejectedValue(
      new Error("User denied transaction signature")
    ),
  };

  const { getByRole, queryByText } = render(<CreateJobForm />);
  fireEvent.click(getByRole("button", { name: /create job/i }));

  await waitFor(() => expect(queryByText(/try again/i)).toBeInTheDocument());
  expect(queryByText(/job created/i)).toBeNull();
});
