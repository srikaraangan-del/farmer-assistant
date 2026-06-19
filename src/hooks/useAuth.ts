import { trpc } from "@/providers/trpc";
import { useCallback, useMemo } from "react";

export function useAuth() {
  const utils = trpc.useUtils();

  // Check local auth first
  const {
    data: localUser,
    isLoading: localLoading,
  } = trpc.localAuth.me.useQuery(undefined, {
    staleTime: 1000 * 60 * 5,
    retry: false,
  });

  // Check Kimi OAuth as fallback
  const {
    data: oauthUser,
    isLoading: oauthLoading,
  } = trpc.auth.me.useQuery(undefined, {
    staleTime: 1000 * 60 * 5,
    retry: false,
    enabled: !localUser, // Only check OAuth if no local user
  });

  const logoutMutation = trpc.auth.logout.useMutation({
    onSuccess: async () => {
      await utils.invalidate();
    },
  });

  // Normalize user object - works with both auth systems
  const user = useMemo(() => {
    if (localUser) {
      return {
        id: localUser.id,
        name: localUser.name ?? localUser.username,
        email: null,
        avatar: null,
        role: localUser.role,
        unionId: `local_${localUser.id}`,
      };
    }
    if (oauthUser) {
      return oauthUser;
    }
    return null;
  }, [localUser, oauthUser]);

  const isLoading = localLoading || (!localUser && oauthLoading);

  const logout = useCallback(() => {
    // Always clear local auth token
    localStorage.removeItem("local_auth_token");
    // Always call OAuth logout too (safe no-op if not using OAuth)
    logoutMutation.mutate(undefined, {
      onSettled: () => {
        // Refresh the page to clear all auth state
        window.location.reload();
      },
    });
  }, [logoutMutation]);

  return useMemo(
    () => ({
      user,
      isAuthenticated: !!user,
      isAdmin: user?.role === "admin",
      isLoading,
      logout,
      refresh: () => utils.invalidate(),
    }),
    [user, isLoading, logout, utils],
  );
}
