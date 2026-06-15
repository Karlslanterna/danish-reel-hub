import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export const Route = createFileRoute("/admin/import")({
  head: () => ({
    meta: [
      { title: "Kultunaut Import — Admin" },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  component: AdminImportPage,
});

type FileStats = {
  sizeKb: number;
  movies: number;
  theaters: number;
  times: number;
};

function countTag(xml: string, tag: string): number {
  const re = new RegExp(`<${tag}(\\s|>|/)`, "gi");
  return (xml.match(re) ?? []).length;
}

function computeStats(xml: string): FileStats {
  return {
    sizeKb: Math.round((new Blob([xml]).size / 1024) * 10) / 10,
    movies: countTag(xml, "movie") + countTag(xml, "film"),
    theaters: countTag(xml, "theater") + countTag(xml, "cinema"),
    times: countTag(xml, "time") + countTag(xml, "showtime") + countTag(xml, "screening"),
  };
}

const SECRET_STORAGE_KEY = "kultunaut-import-secret";

function AdminImportPage() {
  const navigate = useNavigate();
  const [secret, setSecret] = useState(() => {
    if (typeof window === "undefined") return "";
    return window.sessionStorage.getItem(SECRET_STORAGE_KEY) ?? "";
  });
  const [fileName, setFileName] = useState<string | null>(null);
  const [xml, setXml] = useState<string>("");
  const [stats, setStats] = useState<FileStats | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    setError(null);
    const file = e.target.files?.[0];
    if (!file) {
      setFileName(null);
      setXml("");
      setStats(null);
      return;
    }
    const text = await file.text();
    setFileName(file.name);
    setXml(text);
    setStats(computeStats(text));
  };

  const onRunImport = async () => {
    if (!xml) return setError("Vælg en XML-fil først.");
    if (!secret) return setError("Indtast import-hemmeligheden (x-kultunaut-secret).");
    setUploading(true);
    setError(null);
    try {
      window.sessionStorage.setItem(SECRET_STORAGE_KEY, secret);
      const res = await fetch("/api/public/kultunaut-import", {
        method: "POST",
        headers: {
          "Content-Type": "application/xml",
          "x-kultunaut-secret": secret,
        },
        body: xml,
      });
      if (!res.ok && res.status !== 202) {
        const text = await res.text();
        setError(`HTTP ${res.status}: ${text || res.statusText}`);
        return;
      }
      const { jobId } = (await res.json()) as { jobId: string };
      navigate({ to: "/admin/import/$jobId", params: { jobId } });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Ukendt fejl");
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="mx-auto max-w-3xl px-4 py-12">
      <header className="mb-8">
        <p className="text-sm uppercase tracking-wider text-muted-foreground">Admin</p>
        <h1 className="mt-1 font-display text-3xl font-bold text-foreground">
          Kultunaut Import
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Upload en Kultunaut-XML-fil. Import køres som baggrundsjob — du
          omdirigeres til en status-side.
        </p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle>1. Vælg fil og hemmelighed</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="xml-file">XML-fil</Label>
            <Input
              id="xml-file"
              type="file"
              accept=".xml,application/xml,text/xml"
              onChange={onFileChange}
            />
            {fileName && (
              <p className="text-xs text-muted-foreground">Valgt: {fileName}</p>
            )}
          </div>
          <div className="space-y-2">
            <Label htmlFor="secret">Import-hemmelighed</Label>
            <Input
              id="secret"
              type="password"
              placeholder="x-kultunaut-secret"
              value={secret}
              onChange={(e) => setSecret(e.target.value)}
              autoComplete="off"
            />
          </div>
        </CardContent>
      </Card>

      {stats && (
        <Card className="mt-6">
          <CardHeader>
            <CardTitle>2. Forhåndsvisning</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              <Stat label="Størrelse" value={`${stats.sizeKb} KB`} />
              <Stat label="<movie>" value={stats.movies} />
              <Stat label="<theater>" value={stats.theaters} />
              <Stat label="<time>" value={stats.times} />
            </dl>
          </CardContent>
        </Card>
      )}

      <div className="mt-6">
        <Button onClick={onRunImport} disabled={uploading || !xml}>
          {uploading ? "Uploader…" : "3. Start import"}
        </Button>
      </div>

      {error && (
        <Card className="mt-6 border-destructive">
          <CardHeader>
            <CardTitle className="text-destructive">Fejl</CardTitle>
          </CardHeader>
          <CardContent>
            <pre className="whitespace-pre-wrap break-words text-sm text-destructive">
              {error}
            </pre>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wider text-muted-foreground">
        {label}
      </dt>
      <dd className="mt-1 font-display text-2xl font-bold text-foreground">
        {value}
      </dd>
    </div>
  );
}
