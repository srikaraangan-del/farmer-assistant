import { useState } from "react";
import { trpc } from "@/providers/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import {
  CloudSun,
  Thermometer,
  Droplets,
  Wind,
  Eye,
  Umbrella,
  Search,
  MapPin,
  ChevronLeft,
  ChevronRight,
  Gauge,
  Clock,
  Sun,
  CloudRain,
  MapPinned,
  Navigation,
  RefreshCw,
} from "lucide-react";

function formatDate(date: Date | string) {
  return new Date(date).toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

export default function Weather() {
  const [pincodeSearch, setPincodeSearch] = useState("");
  const [activePincode, setActivePincode] = useState<string | null>(null);
  const utils = trpc.useUtils();

  // List all cached weather data
  const { data, isLoading } = trpc.weather.list.useQuery();

  // Get weather by pincode
  const { data: pincodeWeather, isLoading: pincodeLoading } = trpc.weather.getByPincode.useQuery(
    { pincode: activePincode! },
    { enabled: !!activePincode }
  );

  // Get all pincodes with weather
  const { data: pincodesData } = trpc.weather.pincodes.useQuery();

  const handlePincodeSearch = () => {
    if (!pincodeSearch.trim() || pincodeSearch.trim().length !== 6) {
      toast.error("Please enter a valid 6-digit pincode");
      return;
    }
    setActivePincode(pincodeSearch.trim());
  };

  const handleRefresh = () => {
    if (activePincode) {
      utils.weather.getByPincode.invalidate({ pincode: activePincode });
      utils.weather.pincodes.invalidate();
    }
  };

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-10 w-32" />
        </div>
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-32" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Weather Data</h1>
          <p className="text-muted-foreground">
            Weather information by location and pincode
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="gap-1">
            <CloudSun className="h-3 w-3" />
            {pincodesData?.length ?? 0} Pincodes
          </Badge>
          <Badge variant="outline" className="gap-1">
            <MapPin className="h-3 w-3" />
            {data?.total ?? 0} Records
          </Badge>
        </div>
      </div>

      {/* Pincode Search */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Search className="h-4 w-4" />
            Search Weather by Pincode
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex gap-2">
            <Input
              placeholder="Enter 6-digit pincode (e.g., 500001)"
              value={pincodeSearch}
              onChange={(e) => setPincodeSearch(e.target.value.replace(/\D/g, "").slice(0, 6))}
              maxLength={6}
              className="max-w-xs"
            />
            <Button onClick={handlePincodeSearch} disabled={pincodeLoading}>
              {pincodeLoading ? (
                <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Search className="h-4 w-4 mr-2" />
              )}
              Get Weather
            </Button>
            {activePincode && (
              <Button variant="outline" onClick={handleRefresh}>
                <RefreshCw className="h-4 w-4 mr-2" />
                Refresh
              </Button>
            )}
          </div>
          <p className="text-xs text-muted-foreground mt-2">
            Enter a 6-digit Indian pincode to fetch live weather data for that area.
          </p>
        </CardContent>
      </Card>

      {/* Pincode Weather Result */}
      {activePincode && pincodeWeather && (
        <>
          {"error" in pincodeWeather && pincodeWeather.error && (
            <Card className="border-yellow-200 bg-yellow-50">
              <CardContent className="pt-6">
                <p className="text-yellow-800">{pincodeWeather.error}</p>
              </CardContent>
            </Card>
          )}

          {pincodeWeather.data && (
            <Card className="border-blue-200">
              <CardHeader className="bg-blue-50">
                <CardTitle className="flex items-center justify-between text-base">
                  <span className="flex items-center gap-2">
                    <MapPinned className="h-5 w-5 text-blue-600" />
                    Pincode {activePincode} — {pincodeWeather.data.location}
                  </span>
                  <Badge variant={pincodeWeather.source === "live" ? "default" : "secondary"}>
                    {pincodeWeather.source === "live" ? "Live Data" : "Cached"}
                  </Badge>
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-6">
                <WeatherDetailCard data={pincodeWeather.data as any} />
              </CardContent>
            </Card>
          )}
        </>
      )}

      {/* Pincodes with Weather */}
      {pincodesData && pincodesData.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Navigation className="h-4 w-4" />
              Weather by Pincode
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {pincodesData.map((pw) => (
                <Card
                  key={pw.pincode}
                  className={`cursor-pointer transition-colors hover:bg-accent ${activePincode === pw.pincode ? "ring-2 ring-primary" : ""}`}
                  onClick={() => {
                    setActivePincode(pw.pincode!);
                    setPincodeSearch(pw.pincode!);
                  }}
                >
                  <CardContent className="p-4">
                    <div className="flex items-center justify-between mb-2">
                      <span className="font-semibold text-sm">{pw.pincode}</span>
                      <Badge variant="outline" className="text-xs">
                        {pw.weatherCondition}
                      </Badge>
                    </div>
                    <p className="text-xs text-muted-foreground mb-2">{pw.location}</p>
                    <div className="flex items-center gap-4 text-sm">
                      <span className="flex items-center gap-1">
                        <Thermometer className="h-3 w-3 text-orange-500" />
                        {pw.temperature}°C
                      </span>
                      <span className="flex items-center gap-1">
                        <Droplets className="h-3 w-3 text-blue-500" />
                        {pw.humidity}%
                      </span>
                      <span className="flex items-center gap-1">
                        <Umbrella className="h-3 w-3 text-purple-500" />
                        {pw.rainProbability}%
                      </span>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* All Weather Records */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">All Weather Records</CardTitle>
        </CardHeader>
        <CardContent>
          {data?.items && data.items.length > 0 ? (
            <div className="space-y-3">
              {data.items.map((item) => (
                <div
                  key={item.id}
                  className="flex items-center justify-between rounded-lg border p-3"
                >
                  <div className="flex items-center gap-3">
                    <div className="rounded-full bg-blue-50 p-2">
                      <CloudSun className="h-4 w-4 text-blue-600" />
                    </div>
                    <div>
                      <p className="font-medium text-sm">
                        {item.location}
                        {item.pincode && (
                          <Badge variant="outline" className="ml-2 text-xs">
                            {item.pincode}
                          </Badge>
                        )}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {item.district && `${item.district}, `}
                        {item.state}
                        {item.state && item.date ? " — " : ""}
                        {item.date ? formatDate(item.date) : ""}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 text-sm">
                    <span className="flex items-center gap-1">
                      <Thermometer className="h-3 w-3 text-orange-500" />
                      {item.temperature}°C
                    </span>
                    <span className="flex items-center gap-1">
                      <Droplets className="h-3 w-3 text-blue-500" />
                      {item.humidity}%
                    </span>
                    <Badge variant="outline" className="text-xs">
                      {item.weatherCondition}
                    </Badge>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground text-center py-8">
              No weather data available. Search by pincode to add data.
            </p>
          )}
        </CardContent>
      </Card>

      {/* Pagination */}
      {data && data.totalPages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">
            Page {data.page} of {data.totalPages}
          </p>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={data.page <= 1}
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={data.page >= data.totalPages}
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

// Weather detail card component
function WeatherDetailCard({ data }: { data: any }) {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="rounded-lg bg-orange-50 p-3 text-center">
          <Thermometer className="h-5 w-5 text-orange-600 mx-auto mb-1" />
          <p className="text-lg font-bold">{data.temperature}°C</p>
          <p className="text-xs text-muted-foreground">Temperature</p>
        </div>
        <div className="rounded-lg bg-blue-50 p-3 text-center">
          <Droplets className="h-5 w-5 text-blue-600 mx-auto mb-1" />
          <p className="text-lg font-bold">{data.humidity}%</p>
          <p className="text-xs text-muted-foreground">Humidity</p>
        </div>
        <div className="rounded-lg bg-purple-50 p-3 text-center">
          <Umbrella className="h-5 w-5 text-purple-600 mx-auto mb-1" />
          <p className="text-lg font-bold">{data.rainProbability}%</p>
          <p className="text-xs text-muted-foreground">Rain Chance</p>
        </div>
        <div className="rounded-lg bg-green-50 p-3 text-center">
          <Wind className="h-5 w-5 text-green-600 mx-auto mb-1" />
          <p className="text-lg font-bold">{data.windSpeed} km/h</p>
          <p className="text-xs text-muted-foreground">Wind</p>
        </div>
      </div>
      {data.condition && (
        <div className="rounded-lg bg-gray-50 p-3">
          <p className="text-sm font-medium">Condition: {data.condition}</p>
          {data.description && (
            <p className="text-xs text-muted-foreground mt-1">{data.description}</p>
          )}
        </div>
      )}
      {data.forecast && (
        <div>
          <h4 className="text-sm font-medium mb-2">5-Day Forecast</h4>
          <div className="grid grid-cols-5 gap-2">
            {data.forecast.slice(0, 5).map((day: any, i: number) => (
              <div key={i} className="rounded-lg border p-2 text-center">
                <p className="text-xs font-medium">{day.day}</p>
                <p className="text-xs text-orange-600">{day.high}°</p>
                <p className="text-xs text-blue-600">{day.low}°</p>
                <p className="text-[10px] text-muted-foreground">
                  {day.rainProbability > 0 ? `${day.rainProbability}%` : "—"}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
