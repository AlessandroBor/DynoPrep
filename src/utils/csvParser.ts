export interface SessionMetadata {
  format: string;
  venue: string;
  vehicle: string;
  user: string;
  dataSource: string;
  comment: string;
  date: string;
  time: string;
  sampleRate: number;
  duration: number;
  segment: string;
}

export interface DataPoint {
  time: number;
  rpm: number;
  throttle: number | null;
  gpsLat: number;
  gpsLon: number;
}

export interface ParsedSession {
  metadata: SessionMetadata;
  data: DataPoint[];
  hasThrottle: boolean;
  channels: string[];
  gpsLatChannel: string;
  gpsLonChannel: string;
  rawHeader: string; // Original metadata header text to preserve on export
}

function parseMetadataLine(line: string): [string, string] {
  const match = line.match(/^"([^"]+)","([^"]*)"$/);
  if (!match) return ["", ""];
  return [match[1], match[2]];
}

/** Find a channel name matching any of the candidates (case-insensitive) */
function findChannel(channelNames: string[], candidates: string[]): string | null {
  for (const candidate of candidates) {
    const found = channelNames.find((ch) => ch.toLowerCase() === candidate.toLowerCase());
    if (found) return found;
  }
  return null;
}

/**
 * Try to parse as MyChron format (with metadata + quoted headers).
 * If that fails, try plain CSV (just header + data rows).
 */
export function parseMyChronCSV(content: string): ParsedSession {
  const lines = content.split(/\r?\n/);

  // --- Try MyChron format first: look for quoted header line ---
  let mychronHeaderLine = -1;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line.startsWith('"Time"') && line.includes('"RPM"')) {
      mychronHeaderLine = i;
      break;
    }
  }

  if (mychronHeaderLine >= 0) {
    return parseMyChronFormat(lines, mychronHeaderLine);
  }

  // --- Fallback: plain CSV (unquoted header, data immediately after) ---
  return parsePlainCSV(lines);
}

function parseMyChronFormat(lines: string[], headerLine: number): ParsedSession {
  // Capture raw header (everything before the channel header line)
  const rawHeader = lines.slice(0, headerLine).join("\n");

  // Parse metadata from raw header
  const metadata: Partial<SessionMetadata> = {};
  for (let i = 0; i < headerLine; i++) {
    const line = lines[i].trim();
    if (line === "") continue;
    const [key, value] = parseMetadataLine(line);
    if (!key) continue;
    switch (key) {
      case "Format": metadata.format = value; break;
      case "Venue": metadata.venue = value; break;
      case "Vehicle": metadata.vehicle = value; break;
      case "User": metadata.user = value; break;
      case "Data Source": metadata.dataSource = value; break;
      case "Comment": metadata.comment = value; break;
      case "Date": metadata.date = value; break;
      case "Time": metadata.time = value; break;
      case "Sample Rate": metadata.sampleRate = parseFloat(value); break;
      case "Duration": metadata.duration = parseFloat(value); break;
      case "Segment": metadata.segment = value; break;
    }
  }

  // Parse channel names from the quoted header
  const channelNames = lines[headerLine].split(",")
    .map(s => s.replace(/"/g, "").trim())
    .filter(s => s.length > 0);

  // Data starts after: header, header duplicate, units, indices, blank line
  const dataStartLine = headerLine + 5;

  return buildSession(lines, dataStartLine, channelNames, metadata, rawHeader);
}

function parsePlainCSV(lines: string[]): ParsedSession {
  // Find the header line: first non-empty line that looks like column names
  let headerLine = -1;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line === "") continue;
    // Check if it contains "Time" and "RPM" (unquoted)
    const parts = line.split(",").map(s => s.trim());
    if (parts.includes("Time") && parts.includes("RPM")) {
      headerLine = i;
      break;
    }
  }

  if (headerLine < 0) {
    throw new Error("Could not find header row with Time and RPM columns.");
  }

  const channelNames = lines[headerLine].split(",")
    .map(s => s.replace(/"/g, "").trim())
    .filter(s => s.length > 0);

  // Data starts immediately after the header
  const dataStartLine = headerLine + 1;

  // Build default metadata
  const metadata: Partial<SessionMetadata> = {
    format: "CSV",
    venue: "",
    vehicle: "",
    user: "",
    dataSource: "",
    comment: "",
    date: "",
    time: "",
    sampleRate: 0,
    duration: 0,
    segment: "",
  };

  return buildSession(lines, dataStartLine, channelNames, metadata, "");
}

function buildSession(
  lines: string[],
  dataStartLine: number,
  channelNames: string[],
  metadata: Partial<SessionMetadata>,
  rawHeader: string,
): ParsedSession {
  const hasThrottle = channelNames.includes("Throttle");

  const colMap: Record<string, number> = {};
  channelNames.forEach((name, idx) => {
    colMap[name] = idx;
  });

  if (!("Time" in colMap)) {
    throw new Error(`Required channel "Time" not found. Available: ${channelNames.join(", ")}`);
  }
  if (!("RPM" in colMap)) {
    throw new Error(`Required channel "RPM" not found. Available: ${channelNames.join(", ")}`);
  }

  const gpsLatChannel = findChannel(channelNames, [
    "GPS_Latitude", "GPS_LatAcc", "GPS_Lat", "Latitude", "Lat",
  ]);
  const gpsLonChannel = findChannel(channelNames, [
    "GPS_Longitude", "GPS_LonAcc", "GPS_Lon", "Longitude", "Lon",
  ]);

  if (!gpsLatChannel || !gpsLonChannel) {
    throw new Error(
      `GPS channels not found. Need latitude + longitude columns. Available: ${channelNames.join(", ")}`
    );
  }

  const data: DataPoint[] = [];
  for (let i = dataStartLine; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line === "") continue;

    const values = line.split(",").map(s => s.trim());
    if (values.length < channelNames.length - 1) continue;

    const time = parseFloat(values[colMap["Time"]]);
    const rpm = parseFloat(values[colMap["RPM"]]);
    const gpsLat = parseFloat(values[colMap[gpsLatChannel]]);
    const gpsLon = parseFloat(values[colMap[gpsLonChannel]]);

    if (isNaN(time) || isNaN(rpm)) continue;

    const throttle = hasThrottle ? parseFloat(values[colMap["Throttle"]]) : null;

    data.push({
      time,
      rpm,
      throttle: throttle !== null && !isNaN(throttle) ? throttle : null,
      gpsLat: isNaN(gpsLat) ? 0 : gpsLat,
      gpsLon: isNaN(gpsLon) ? 0 : gpsLon,
    });
  }

  // Auto-detect sample rate if not in metadata
  if (!metadata.sampleRate && data.length > 1) {
    const dt = data[1].time - data[0].time;
    if (dt > 0) metadata.sampleRate = Math.round(1 / dt);
  }
  if (!metadata.duration && data.length > 0) {
    metadata.duration = data[data.length - 1].time - data[0].time;
  }

  return {
    metadata: metadata as SessionMetadata,
    data,
    hasThrottle,
    channels: channelNames,
    gpsLatChannel,
    gpsLonChannel,
    rawHeader,
  };
}
