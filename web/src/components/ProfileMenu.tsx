import { useEffect, useRef, useState } from "react";
import { getAccount, getProfile, logOut, setProfileName } from "../api.ts";
import { ForgetMe } from "./ForgetMe.tsx";
import { SignIn } from "./SignIn.tsx";
import { SyncPanel } from "./SyncPanel.tsx";

type Panel = "menu" | "name" | "devices";

/**
 * The account menu.
 *
 * One screen at a time. Everything this can do used to be listed at once, which
 * turned an account into a control panel — a name field, both halves of the
 * device flow and an erase button all competing in the width of a phone.
 */
export function ProfileMenu({ onIdentityChange }: { onIdentityChange: () => void }) {
  const [open, setOpen] = useState(false);
  const [panel, setPanel] = useState<Panel>("menu");
  const [signingIn, setSigningIn] = useState(false);
  const [email, setEmail] = useState<string | null>(null);
  const [name, setName] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    getAccount()
      .then((a) => setEmail(a.account?.email ?? null))
      .catch(() => undefined);
    getProfile()
      .then((p) => {
        setName(p.name);
        setDraft(p.name ?? "");
      })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!open) return;

    const shut = () => {
      setOpen(false);
      setPanel("menu");
      setProblem(null);
    };
    const onDown = (e: MouseEvent) => {
      if (!root.current?.contains(e.target as Node)) shut();
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && shut();

    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  function close() {
    setOpen(false);
    setPanel("menu");
    setProblem(null);
  }

  function saveName() {
    setProblem(null);
    setProfileName(draft)
      .then((p) => {
        setName(p.name);
        setDraft(p.name ?? "");
        setPanel("menu");
      })
      .catch((e: unknown) =>
        setProblem(e instanceof Error ? e.message : "Could not save that."),
      );
  }

  function signOut() {
    logOut()
      .then(() => {
        setEmail(null);
        close();
        onIdentityChange();
      })
      .catch((e: unknown) =>
        setProblem(e instanceof Error ? e.message : "Could not sign out."),
      );
  }

  const label = name ?? email;

  return (
    <>
      <div className="profile" ref={root}>
        <button
          className="avatar-btn"
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-label={label ? `Account: ${label}` : "Account"}
          onClick={() => (open ? close() : setOpen(true))}
        >
          <span className="avatar">{initials(label)}</span>
        </button>

        {open && (
          <div className="profile-menu" role="dialog" aria-label="Account">
            {panel === "menu" && (
              <>
                <div className="profile-head">
                  <span className="avatar lg">{initials(label)}</span>
                  <div className="profile-who">
                    <strong>{name ?? email ?? "Not signed in"}</strong>
                    <span className="faint">
                      {email ? (name ? email : "Signed in") : "Saved on this device"}
                    </span>
                  </div>
                </div>

                <div className="menu-items">
                  <button className="menu-item" onClick={() => setPanel("name")}>
                    {name ? "Change your name" : "Add your name"}
                  </button>
                  <button className="menu-item" onClick={() => setPanel("devices")}>
                    Use on another device
                  </button>
                </div>

                <div className="menu-items menu-foot">
                  {email ? (
                    <button className="menu-item" onClick={signOut}>
                      Sign out
                    </button>
                  ) : (
                    <button
                      className="menu-item accent"
                      onClick={() => {
                        setSigningIn(true);
                        setOpen(false);
                      }}
                    >
                      Sign in
                    </button>
                  )}
                  <ForgetMe onForgotten={onIdentityChange} onError={setProblem} />
                </div>
              </>
            )}

            {panel === "name" && (
              <Sub title="Your name" onBack={() => setPanel("menu")}>
                <div className="profile-name">
                  <input
                    value={draft}
                    maxLength={32}
                    autoFocus
                    placeholder="What should we call you?"
                    aria-label="Your name"
                    onChange={(e) => setDraft(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && saveName()}
                  />
                  <button className="card-btn" onClick={saveName}>
                    Save
                  </button>
                </div>
                <p className="faint menu-note">
                  Shown only to you. It is where the initials come from.
                </p>
              </Sub>
            )}

            {panel === "devices" && (
              <Sub title="Another device" onBack={() => setPanel("menu")}>
                <SyncPanel onAdopted={onIdentityChange} />
                {!email && (
                  <p className="faint menu-note">
                    Signing in does the same thing, without a code to carry.
                  </p>
                )}
              </Sub>
            )}

            {problem && <p className="notice profile-problem">{problem}</p>}
          </div>
        )}
      </div>

      {signingIn && (
        <SignIn
          onClose={() => setSigningIn(false)}
          onDone={(addr) => {
            setEmail(addr);
            setSigningIn(false);
            onIdentityChange();
          }}
        />
      )}
    </>
  );
}

function Sub({
  title,
  onBack,
  children,
}: {
  title: string;
  onBack: () => void;
  children: React.ReactNode;
}) {
  return (
    <>
      <div className="sub-head">
        <button className="link-btn" onClick={onBack} aria-label="Back">
          ‹
        </button>
        <strong>{title}</strong>
      </div>
      {children}
    </>
  );
}

/** Initials from a name, the first letter of an email otherwise. */
function initials(label: string | null): string {
  const clean = (label ?? "").trim();
  if (clean.length === 0) return "\u25CF";
  if (clean.includes("@")) return clean[0]!.toUpperCase();

  return clean
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("");
}
