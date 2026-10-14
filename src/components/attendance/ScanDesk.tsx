"use client";

import { scanCode } from "@/app/app/_actions/attendance";
import { QrScanner } from "./QrScanner";

export function ScanDesk() {
  return <QrScanner onScan={scanCode} />;
}
