/** The role the owner app's account chip shows: the role in the current program, else "Owner" when the wallet owns
 * any program (or none yet: it's signing in to create one), else "Reviewer". */
export function accountRole(
  programs: { role: "owner" | "reviewer" }[],
  current?: { role: "owner" | "reviewer" },
): "Owner" | "Reviewer" {
  const role = current?.role ?? (programs.length === 0 || programs.some((p) => p.role === "owner") ? "owner" : "reviewer");
  return role === "owner" ? "Owner" : "Reviewer";
}
