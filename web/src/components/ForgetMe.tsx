import { forgetMe } from "../api.ts";

/**
 * The way out.
 *
 * Signing out only unlinks an account; this is the one that erases. It has to
 * exist whether or not somebody ever said who they were, because a list and a
 * record of what you have already been told are your data either way.
 */
export function ForgetMe({
  onForgotten,
  onError,
}: {
  onForgotten: () => void;
  onError: (message: string) => void;
}) {
  return (
    <button
      className="menu-item danger"
      onClick={() => {
        if (
          window.confirm(
            "Delete every list, and the record of what you have already seen? This cannot be undone.",
          )
        ) {
          forgetMe()
            .then(onForgotten)
            // Believing your data is gone when it is not is worse than any
            // other failure this button could have.
            .catch((e: unknown) =>
              onError(e instanceof Error ? e.message : "Nothing was deleted."),
            );
        }
      }}
    >
      Delete everything
    </button>
  );
}

