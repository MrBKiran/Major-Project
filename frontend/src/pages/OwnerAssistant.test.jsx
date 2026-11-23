/**
 * The owner app's assistant: one conversation about every car, typed or spoken. The server is faked
 * and the browser's microphone and voice are stood in for by `../voice.js`, so what is checked is
 * what the owner sees and what the page sends.
 */

import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { StrictMode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../auth/AuthContext.jsx", () => ({ useAuth: () => ({ logout: vi.fn() }) }));
vi.mock("../api.js", () => ({ api: { get: vi.fn(), post: vi.fn(), del: vi.fn(), upload: vi.fn() } }));

vi.mock("../voice.js", async () => {
  const { useState } = await import("react");
  const control = {
    mic: true,
    start: vi.fn(async () => "ok"),
    stop: vi.fn(async () => ({ blob: new Blob(["audio"], { type: "audio/webm" }), name: "voice.webm" })),
    speak: vi.fn(),
    stopSpeaking: vi.fn(),
    onLimit: null,
  };
  return {
    __control: control,
    micAvailable: () => control.mic,
    speechAvailable: () => true,
    speak: (...args) => control.speak(...args),
    stopSpeaking: () => control.stopSpeaking(),
    useRecorder: (onLimit) => {
      control.onLimit = onLimit;
      const [recording, setRecording] = useState(false);
      return {
        recording,
        start: async () => { const r = await control.start(); setRecording(r === "ok"); return r; },
        stop: async () => { setRecording(false); return control.stop(); },
      };
    },
  };
});

const { api } = await import("../api.js");
const voice = (await import("../voice.js")).__control;
const { default: OwnerApp } = await import("./OwnerApp.jsx");

const VIN = "MH12AB1001";
const BATTERY = { component: "battery", severity: "P1", days_to_failure: 6, failure_prob: 0.81 };
const PROPOSAL = { id: "act-1", kind: "book", summary: "Book the Bolero at Kothrud on Mon 23 Nov, 9:00 am" };
const MADE = { appointment_id: "APT-9", center_id: "SC-PUN-01", center_name: "Kothrud", slot_start: "2026-11-23T09:00:00+05:30", status: "booked" };

Element.prototype.scrollIntoView = vi.fn();

/** The owner's car, with a battery warning, and whatever the assistant's thread already holds. */
function serve(thread = { turns: [], pending_action: null }, { healthy = false } = {}) {
  api.get.mockImplementation((path) => {
    if (path === "/api/fleet") return Promise.resolve({ vehicles: [{ vin: VIN, severity: healthy ? null : "P1" }] });
    if (path === `/api/vehicle/${VIN}`) {
      return Promise.resolve({
        vehicle: { vin: VIN, model: "Bolero", odometer: 128400 },
        series: [], predictions: healthy ? [] : [BATTERY], maintenance_history: [], dtc_codes: [],
      });
    }
    if (path === `/api/vehicles/${VIN}/service`) {
      return Promise.resolve({
        vin: VIN, model: "Bolero", city: "Pune",
        alert: healthy ? null : { component: "battery", severity: "P1", days_to_failure: 6 },
        economics: healthy ? null : { repair_inr: 5200, breakdown_inr: 9000 }, booking: null, slots: [],
      });
    }
    if (path === "/api/assistant/thread") return Promise.resolve(thread);
    return Promise.reject(new Error(`unexpected GET ${path}`));
  });
}

const reply = (text, extra = {}) => ({ reply: text, pending_action: null, done: null, ...extra });
const posted = (path) => api.post.mock.calls.filter(([p]) => p === path);

async function open(thread) {
  serve(thread);
  render(<OwnerApp />);
  fireEvent.click(await screen.findByRole("button", { name: "Talk to the agent" }));
  await screen.findByRole("button", { name: "Send" });
}

async function ask(text) {
  fireEvent.change(screen.getByLabelText("Message"), { target: { value: text } });
  fireEvent.click(screen.getByRole("button", { name: "Send" }));
}

beforeEach(() => {
  api.get.mockReset(); api.post.mockReset(); api.del.mockReset(); api.upload.mockReset();
  [voice.start, voice.stop, voice.speak, voice.stopSpeaking].forEach((m) => m.mockClear());
  voice.mic = true;
  voice.onLimit = null;
  voice.start.mockResolvedValue("ok");
  voice.stop.mockResolvedValue({ blob: new Blob(["audio"], { type: "audio/webm" }), name: "voice.webm" });
});

describe("opening", () => {
  it("says what it can do and offers a few things to ask", async () => {
    await open();
    expect(await screen.findByText("Ask me about your cars")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "How is my car doing?" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Talk to the assistant" })).toBeInTheDocument();
  });

  it("resumes the conversation, and anything still waiting for a yes", async () => {
    await open({
      turns: [{ id: 1, role: "user", text: "Book me a service" }, { id: 2, role: "assistant", text: "I can book Mon 23 Nov. Shall I?" }],
      pending_action: PROPOSAL,
    });
    expect(await screen.findByText(/Shall I\?/)).toBeInTheDocument();
    expect(screen.getByText("Book me a service")).toBeInTheDocument();
    expect(screen.getByText(PROPOSAL.summary)).toBeInTheDocument();
    expect(screen.queryByText("Ask me about your cars")).not.toBeInTheDocument();
  });

  it("is reached from Book a service already asking for one, and asks only once", async () => {
    serve();
    api.post.mockResolvedValue(reply("I can book that. Shall I?", { pending_action: PROPOSAL }));
    render(<OwnerApp />);
    fireEvent.click(await screen.findByRole("button", { name: "Book a service" }));
    expect(await screen.findByText("Waiting for your yes")).toBeInTheDocument();
    expect(posted("/api/assistant/message")).toEqual([["/api/assistant/message", { message: "Book me a service", channel: "text", vin: VIN }]]);
    expect(screen.getByText("Book me a service")).toBeInTheDocument();
  });

  it("is reachable when nothing is wrong too, so a healthy screen is not a dead end", async () => {
    serve(undefined, { healthy: true });
    render(<OwnerApp />);
    await screen.findByText(/everything reads normal/i);
    fireEvent.click(screen.getByRole("button", { name: "Ask the assistant" }));
    expect(await screen.findByText("Ask me about your cars")).toBeInTheDocument();
    expect(posted("/api/assistant/message")).toEqual([]);
  });

  it("is not offered twice when a warning is showing, because that card has its own way in", async () => {
    serve();
    render(<OwnerApp />);
    await screen.findByRole("button", { name: "Talk to the agent" });
    expect(screen.queryByRole("button", { name: "Ask the assistant" })).not.toBeInTheDocument();
  });

  it("is reached from Talk to the agent without asking anything", async () => {
    await open();
    expect(posted("/api/assistant/message")).toEqual([]);
  });
});

describe("typing", () => {
  it("sends the message with the car being looked at, and answers in writing", async () => {
    await open();
    api.post.mockResolvedValue(reply("Your battery is wearing out."));
    await ask("How are my cars?");
    expect(await screen.findByText("Your battery is wearing out.")).toBeInTheDocument();
    expect(screen.getByText("How are my cars?")).toBeInTheDocument();
    expect(posted("/api/assistant/message")[0][1]).toEqual({ message: "How are my cars?", channel: "text", vin: VIN });
    expect(voice.speak).not.toHaveBeenCalled();
  });

  it("does not send an empty message", async () => {
    await open();
    expect(screen.getByRole("button", { name: "Send" })).toBeDisabled();
  });

  it("sends a suggestion as if it were typed", async () => {
    await open();
    api.post.mockResolvedValue(reply("About ₹5,200."));
    fireEvent.click(screen.getByRole("button", { name: "What will it cost if I wait?" }));
    await screen.findByText("About ₹5,200.");
    expect(posted("/api/assistant/message")[0][1].message).toBe("What will it cost if I wait?");
  });

  it("shows why a message did not go through", async () => {
    await open();
    api.post.mockRejectedValue(new Error("slow down a little, try again in 5s"));
    await ask("hello");
    expect(await screen.findByText("slow down a little, try again in 5s")).toBeInTheDocument();
  });

  it("reads the reply aloud once the owner asks for that", async () => {
    await open();
    api.post.mockResolvedValue(reply("All fine."));
    fireEvent.click(screen.getByLabelText("Read replies aloud"));
    await ask("How are things?");
    await screen.findByText("All fine.");
    expect(voice.speak).toHaveBeenCalledWith("All fine.", expect.any(Function));
  });

  it("stops showing Stop once the reply has been read, even under React's development double-mount", async () => {
    serve();
    render(<StrictMode><OwnerApp /></StrictMode>);
    fireEvent.click(await screen.findByRole("button", { name: "Talk to the agent" }));
    await screen.findByRole("button", { name: "Send" });
    api.post.mockResolvedValue(reply("All fine."));
    fireEvent.click(screen.getByLabelText("Read replies aloud"));
    await ask("How are things?");
    expect(await screen.findByRole("button", { name: "Stop" })).toBeInTheDocument();

    const finished = voice.speak.mock.calls[0][1];
    act(() => finished());                                 // the browser says it has finished reading
    expect(screen.queryByRole("button", { name: "Stop" })).not.toBeInTheDocument();
  });

  it("clears the conversation on Start over", async () => {
    await open({ turns: [{ id: 1, role: "user", text: "hello" }], pending_action: null });
    api.del.mockResolvedValue({ cleared: true });
    fireEvent.click(await screen.findByRole("button", { name: "Start over" }));
    expect(await screen.findByText("Ask me about your cars")).toBeInTheDocument();
    expect(api.del).toHaveBeenCalledWith("/api/assistant/thread");
  });
});

describe("a proposal", () => {
  it("books only when the owner says yes, then offers the receipt and refreshes the car", async () => {
    await open();
    api.post.mockImplementation((path) => Promise.resolve(
      path === "/api/assistant/message"
        ? reply("I can book that. Shall I?", { pending_action: PROPOSAL })
        : { ok: true, kind: "book", message: "Done — your Bolero is booked.", booking: MADE },
    ));
    await ask("Book me a service");
    await screen.findByText("Waiting for your yes");
    expect(posted("/api/assistant/actions/act-1/confirm")).toEqual([]);

    const reads = api.get.mock.calls.filter(([p]) => p === `/api/vehicles/${VIN}/service`).length;
    fireEvent.click(screen.getByRole("button", { name: "Yes, do it" }));
    expect(await screen.findByText("Done — your Bolero is booked.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "View receipt" })).toBeInTheDocument();
    expect(screen.queryByText("Waiting for your yes")).not.toBeInTheDocument();
    await waitFor(() => expect(api.get.mock.calls.filter(([p]) => p === `/api/vehicles/${VIN}/service`).length).toBeGreaterThan(reads));
  });

  it("is dropped on No, and says so", async () => {
    await open({ turns: [], pending_action: PROPOSAL });
    api.post.mockResolvedValue({ ok: true, message: "Okay, I won’t do that." });
    fireEvent.click(await screen.findByRole("button", { name: "No" }));
    expect(await screen.findByText(/I won’t do that/)).toBeInTheDocument();
    expect(posted("/api/assistant/actions/act-1/cancel")).toHaveLength(1);
    expect(screen.queryByText("Waiting for your yes")).not.toBeInTheDocument();
  });

  it("explains an offer that has run out, without showing a Yes the owner never gave", async () => {
    await open({ turns: [], pending_action: PROPOSAL });
    api.post.mockResolvedValue({ ok: false, message: "That offer has run out. Ask me again and I’ll set it up fresh." });
    fireEvent.click(await screen.findByRole("button", { name: "Yes, do it" }));
    expect(await screen.findByText(/That offer has run out/)).toBeInTheDocument();
    expect(screen.queryByText("Yes, go ahead.")).not.toBeInTheDocument();
    expect(screen.queryByText("Waiting for your yes")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "View receipt" })).not.toBeInTheDocument();
  });
});

describe("by voice", () => {
  it("records, uploads the clip, asks what it says, and speaks the answer", async () => {
    await open();
    api.upload.mockResolvedValue({ text: "mera brake kab tak chalega" });
    api.post.mockResolvedValue(reply("Lagbhag saat din."));

    fireEvent.click(screen.getByRole("button", { name: "Talk to the assistant" }));
    expect(voice.start).toHaveBeenCalled();
    fireEvent.click(await screen.findByRole("button", { name: "Stop and send" }));

    expect(await screen.findByText("Lagbhag saat din.")).toBeInTheDocument();
    expect(screen.getByText("mera brake kab tak chalega")).toBeInTheDocument();
    const [path, form] = api.upload.mock.calls[0];
    expect(path).toBe("/api/assistant/transcribe");
    expect(form.get("audio").name).toBe("voice.webm");
    expect(posted("/api/assistant/message")[0][1]).toEqual({ message: "mera brake kab tak chalega", channel: "voice", vin: VIN });
    expect(voice.speak).toHaveBeenCalledWith("Lagbhag saat din.", expect.any(Function));
  });

  it("still sends what was said when the recording is cut off at the length limit", async () => {
    await open();
    api.upload.mockResolvedValue({ text: "meri gaadi ka haal batao" });
    api.post.mockResolvedValue(reply("Sab theek hai."));
    fireEvent.click(screen.getByRole("button", { name: "Talk to the assistant" }));
    await screen.findByRole("button", { name: "Stop and send" });

    // The recorder reached its limit by itself; the owner never pressed stop.
    await act(async () => { await voice.onLimit({ blob: new Blob(["long"], { type: "audio/webm" }), name: "voice.webm" }); });

    expect(await screen.findByText("Sab theek hai.")).toBeInTheDocument();
    expect(posted("/api/assistant/message")[0][1].message).toBe("meri gaadi ka haal batao");
  });

  it("asks the owner to type instead when the microphone is not allowed", async () => {
    voice.start.mockResolvedValueOnce("denied");
    await open();
    fireEvent.click(screen.getByRole("button", { name: "Talk to the assistant" }));
    expect(await screen.findByText(/Allow the microphone/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Talk to the assistant" })).toBeInTheDocument();
  });

  it("says so, and asks nothing, when no words were heard", async () => {
    await open();
    api.upload.mockResolvedValue({ text: "  " });
    fireEvent.click(screen.getByRole("button", { name: "Talk to the assistant" }));
    fireEvent.click(await screen.findByRole("button", { name: "Stop and send" }));
    expect(await screen.findByText(/did not catch that/i)).toBeInTheDocument();
    expect(posted("/api/assistant/message")).toEqual([]);
  });

  it("explains a speech service that is down, in the server's words", async () => {
    await open();
    api.upload.mockRejectedValue(new Error("voice is not set up on this server"));
    fireEvent.click(screen.getByRole("button", { name: "Talk to the assistant" }));
    fireEvent.click(await screen.findByRole("button", { name: "Stop and send" }));
    expect(await screen.findByText("voice is not set up on this server")).toBeInTheDocument();
  });

  it("offers no microphone in a browser that cannot record", async () => {
    voice.mic = false;
    await open();
    expect(screen.queryByRole("button", { name: "Talk to the assistant" })).not.toBeInTheDocument();
    expect(screen.getByText(/Type your question below/)).toBeInTheDocument();
  });
});
