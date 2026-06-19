import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { trpc } from "@/providers/trpc";
import { Sprout, Loader2, LogIn, UserPlus } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Separator } from "@/components/ui/separator";

export default function Login() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [mode, setMode] = useState<"login" | "register">("login");

  const loginMutation = trpc.localAuth.login.useMutation({
    onSuccess: (data) => {
      // Save token to localStorage
      localStorage.setItem("local_auth_token", data.token);
      // Refresh the page to trigger auth state update
      window.location.href = "/";
    },
    onError: (err) => {
      setError(err.message || "Invalid username or password");
    },
  });

  const registerMutation = trpc.localAuth.register.useMutation({
    onSuccess: () => {
      setMode("login");
      setError("");
      // Auto-fill the username
    },
    onError: (err) => {
      setError(err.message || "Registration failed");
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (!username.trim() || !password.trim()) {
      setError("Please enter both username and password");
      return;
    }

    if (mode === "login") {
      loginMutation.mutate({ username, password });
    } else {
      if (password.length < 6) {
        setError("Password must be at least 6 characters");
        return;
      }
      registerMutation.mutate({ username, password });
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-green-50 to-emerald-100 p-4">
      <div className="w-full max-w-sm space-y-6">
        {/* Logo */}
        <div className="text-center space-y-2">
          <div className="h-16 w-16 bg-green-600 rounded-2xl flex items-center justify-center mx-auto shadow-lg">
            <Sprout className="h-9 w-9 text-white" />
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-gray-900">
            AI Farmer Assistant
          </h1>
          <p className="text-sm text-muted-foreground">
            Admin Dashboard
          </p>
        </div>

        <Card className="shadow-xl border-0">
          <CardHeader className="pb-4">
            <CardTitle className="text-lg">
              {mode === "login" ? "Sign In" : "Create Account"}
            </CardTitle>
            <CardDescription>
              {mode === "login"
                ? "Enter your credentials to access the dashboard"
                : "Register a new admin account"}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="username">Username</Label>
                <Input
                  id="username"
                  placeholder="Enter username"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  autoComplete="username"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="password">Password</Label>
                <Input
                  id="password"
                  type="password"
                  placeholder="Enter password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete={mode === "login" ? "current-password" : "new-password"}
                />
              </div>

              {error && (
                <Alert variant="destructive" className="text-sm py-2">
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              )}

              <Button
                type="submit"
                className="w-full bg-green-600 hover:bg-green-700"
                size="lg"
                disabled={loginMutation.isPending || registerMutation.isPending}
              >
                {loginMutation.isPending || registerMutation.isPending ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : mode === "login" ? (
                  <LogIn className="h-4 w-4 mr-2" />
                ) : (
                  <UserPlus className="h-4 w-4 mr-2" />
                )}
                {mode === "login" ? "Sign In" : "Create Account"}
              </Button>
            </form>

            <Separator className="my-4" />

            <div className="text-center">
              <button
                type="button"
                onClick={() => {
                  setMode(mode === "login" ? "register" : "login");
                  setError("");
                }}
                className="text-sm text-green-600 hover:text-green-700 hover:underline"
              >
                {mode === "login"
                  ? "Need an account? Register"
                  : "Already have an account? Sign In"}
              </button>
            </div>

            {mode === "login" && (
              <p className="text-xs text-center text-muted-foreground mt-3">
                Default login: <strong>admin</strong> / <strong>admin123</strong>
              </p>
            )}
          </CardContent>
        </Card>

        <p className="text-xs text-center text-muted-foreground">
          AI-powered WhatsApp farmer assistant
        </p>
      </div>
    </div>
  );
}
