import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import {
  Settings as SettingsIcon,
  CloudSun,
  BrainCircuit,
  Smartphone,
} from "lucide-react";

export default function SettingsPage() {
  const [webhookUrl, setWebhookUrl] = useState("https://your-domain.com/api/trpc/whatsapp.receiveMessage");
  const [verifyToken, setVerifyToken] = useState("your_verify_token_here");
  const [apiKey, setApiKey] = useState("sk-xxxxxxxxxxxxxxxx");
  const [weatherApiKey, setWeatherApiKey] = useState("");
  const [priceApiKey, setPriceApiKey] = useState("");
  const [voiceEnabled, setVoiceEnabled] = useState(true);
  const [autoTranslate, setAutoTranslate] = useState(true);
  const [fallbackMode, setFallbackMode] = useState(false);

  return (
    <div className="space-y-6 max-w-4xl">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Settings</h1>
        <p className="text-muted-foreground mt-1">
          Configure your AI Farmer Assistant
        </p>
      </div>

      {/* WhatsApp Settings */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Smartphone className="h-4 w-4" />
            WhatsApp Configuration
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>Webhook URL</Label>
            <Input
              value={webhookUrl}
              onChange={(e) => setWebhookUrl(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              Configure this URL in your WhatsApp Business API dashboard
            </p>
          </div>
          <div className="space-y-2">
            <Label>Verify Token</Label>
            <Input
              value={verifyToken}
              onChange={(e) => setVerifyToken(e.target.value)}
              type="password"
            />
          </div>
          <div className="flex items-center justify-between">
            <div>
              <Label>Webhook Status</Label>
              <p className="text-xs text-muted-foreground">
                Active and receiving messages
              </p>
            </div>
            <Badge variant="default">Active</Badge>
          </div>
        </CardContent>
      </Card>

      {/* AI Settings */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <BrainCircuit className="h-4 w-4" />
            AI & Language Settings
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>OpenAI API Key</Label>
            <Input
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              type="password"
              placeholder="sk-..."
            />
          </div>
          <Separator />
          <div className="flex items-center justify-between">
            <div>
              <Label>Voice Support</Label>
              <p className="text-xs text-muted-foreground">
                Accept and respond to voice messages
              </p>
            </div>
            <Switch checked={voiceEnabled} onCheckedChange={setVoiceEnabled} />
          </div>
          <div className="flex items-center justify-between">
            <div>
              <Label>Auto-Translate</Label>
              <p className="text-xs text-muted-foreground">
                Automatically translate responses to farmer&apos;s language
              </p>
            </div>
            <Switch checked={autoTranslate} onCheckedChange={setAutoTranslate} />
          </div>
          <div className="flex items-center justify-between">
            <div>
              <Label>Fallback Mode</Label>
              <p className="text-xs text-muted-foreground">
                Use keyword matching when AI is unavailable
              </p>
            </div>
            <Switch checked={fallbackMode} onCheckedChange={setFallbackMode} />
          </div>
        </CardContent>
      </Card>

      {/* API Integrations */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <CloudSun className="h-4 w-4" />
            API Integrations
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>Weather API Key</Label>
            <Input
              value={weatherApiKey}
              onChange={(e) => setWeatherApiKey(e.target.value)}
              type="password"
              placeholder="Enter weather API key"
            />
            <p className="text-xs text-muted-foreground">
              Supports OpenWeatherMap, WeatherAPI, or similar
            </p>
          </div>
          <Separator />
          <div className="space-y-2">
            <Label>Market Price API Key</Label>
            <Input
              value={priceApiKey}
              onChange={(e) => setPriceApiKey(e.target.value)}
              type="password"
              placeholder="Enter price API key"
            />
            <p className="text-xs text-muted-foreground">
              Supports Agmarknet, Commodities Control, or similar
            </p>
          </div>
        </CardContent>
      </Card>

      {/* System Settings */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <SettingsIcon className="h-4 w-4" />
            System Settings
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>System Name</Label>
            <Input defaultValue="AI Farmer Assistant" />
          </div>
          <div className="space-y-2">
            <Label>Welcome Message (English)</Label>
            <Textarea
              defaultValue="Hello! Welcome to AI Farmer Assistant. I can help you with weather updates, market prices, government schemes, and farming advice. What would you like to know?"
              rows={3}
            />
          </div>
          <div className="space-y-2">
            <Label>Welcome Message (Hindi)</Label>
            <Textarea
              defaultValue="Namaste! AI Farmer Assistant mein aapka swagat hai. Main aapki madad kar sakta hoon: mausam ki jaankari, bazar bhav, sarkari yojnaayein, aur kheti salah. Aap kya jaanna chahte hain?"
              rows={3}
            />
          </div>
          <div className="space-y-2">
            <Label>Welcome Message (Telugu)</Label>
            <Textarea
              defaultValue="Namaskaram! AI Farmer Assistant ku swagatam. Nenu meeku sahayam cheyagalan vishayaalu: vataavaran paridi, marketu dharalu, praabhutva paddhatulu, mariyu vyavasaaya salaha. Meeku emi telusukovalani undi?"
              rows={3}
            />
          </div>
        </CardContent>
      </Card>

      <div className="flex justify-end gap-3">
        <Button variant="outline">Reset to Defaults</Button>
        <Button>Save Settings</Button>
      </div>
    </div>
  );
}
