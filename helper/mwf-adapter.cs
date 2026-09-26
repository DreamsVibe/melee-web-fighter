// Native messaging host for Melee Web Fighter: reads the GameCube controller adapter (WUP-028, or a
// Mayflash in Wii U mode) through WinUSB, like Dolphin, Slippi and melee-unlocked do, and passes each
// 37-byte report to the extension. Chrome's WebUSB cannot do this itself: the adapter's interface is
// HID class, which Chrome never lets a page or extension claim.
//
// Protocol (Chrome native messaging: 4-byte little-endian length + UTF-8 JSON, both ways):
//   out {"s":"waiting"|"connected"|"silent"|"not-found"|"no-driver"|"busy"|"open-failed"|"disconnected","d":"detail"}
//   out {"r":[37 bytes]}  one per adapter report
//   in  anything: ignored; stdin closing (Chrome disconnected) ends the process.
using System;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using Microsoft.Win32;
using Microsoft.Win32.SafeHandles;

public static class MwfAdapter
{
    const string DeviceKey = @"SYSTEM\CurrentControlSet\Enum\USB\VID_057E&PID_0337";
    const int DIGCF_PRESENT = 0x2, DIGCF_DEVICEINTERFACE = 0x10;
    const uint GENERIC_RW = 0xC0000000, FILE_SHARE_RW = 3, OPEN_EXISTING = 3, FILE_FLAG_OVERLAPPED = 0x40000000, FILE_ATTRIBUTE_NORMAL = 0x80;
    const int PIPE_TRANSFER_TIMEOUT = 3, ERROR_ACCESS_DENIED = 5, ERROR_BAD_COMMAND = 22, ERROR_SEM_TIMEOUT = 121, ERROR_DEVICE_NOT_CONNECTED = 1167;

    [StructLayout(LayoutKind.Sequential)]
    struct SP_DEVICE_INTERFACE_DATA { public int cbSize; public Guid InterfaceClassGuid; public int Flags; public IntPtr Reserved; }

    [StructLayout(LayoutKind.Sequential, Pack = 1)]
    struct USB_INTERFACE_DESCRIPTOR { public byte bLength, bDescriptorType, bInterfaceNumber, bAlternateSetting, bNumEndpoints, bInterfaceClass, bInterfaceSubClass, bInterfaceProtocol, iInterface; }

    [StructLayout(LayoutKind.Sequential, Pack = 1)]
    struct WINUSB_SETUP_PACKET { public byte RequestType, Request; public ushort Value, Index, Length; }

    [StructLayout(LayoutKind.Sequential)]
    struct WINUSB_PIPE_INFORMATION { public int PipeType; public byte PipeId; public ushort MaximumPacketSize; public byte Interval; }

    [DllImport("setupapi.dll", SetLastError = true)] static extern IntPtr SetupDiGetClassDevs(ref Guid g, IntPtr enumerator, IntPtr hwnd, int flags);
    [DllImport("setupapi.dll", SetLastError = true)] static extern bool SetupDiEnumDeviceInterfaces(IntPtr set, IntPtr devInfo, ref Guid g, int index, ref SP_DEVICE_INTERFACE_DATA d);
    [DllImport("setupapi.dll", SetLastError = true, CharSet = CharSet.Unicode)] static extern bool SetupDiGetDeviceInterfaceDetail(IntPtr set, ref SP_DEVICE_INTERFACE_DATA d, IntPtr detail, int size, out int required, IntPtr devInfo);
    [DllImport("setupapi.dll")] static extern bool SetupDiDestroyDeviceInfoList(IntPtr set);
    [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)] static extern SafeFileHandle CreateFile(string name, uint access, uint share, IntPtr sec, uint disposition, uint flags, IntPtr template);
    [DllImport("winusb.dll", SetLastError = true)] static extern bool WinUsb_Initialize(SafeFileHandle h, out IntPtr iface);
    [DllImport("winusb.dll")] static extern bool WinUsb_Free(IntPtr iface);
    [DllImport("winusb.dll", SetLastError = true)] static extern bool WinUsb_QueryInterfaceSettings(IntPtr iface, byte alt, out USB_INTERFACE_DESCRIPTOR d);
    [DllImport("winusb.dll", SetLastError = true)] static extern bool WinUsb_QueryPipe(IntPtr iface, byte alt, byte index, out WINUSB_PIPE_INFORMATION p);
    [DllImport("winusb.dll", SetLastError = true)] static extern bool WinUsb_SetPipePolicy(IntPtr iface, byte pipe, int policy, int length, ref int value);
    [DllImport("winusb.dll", SetLastError = true)] static extern bool WinUsb_WritePipe(IntPtr iface, byte pipe, byte[] buf, int length, out int sent, IntPtr overlapped);
    [DllImport("winusb.dll", SetLastError = true)] static extern bool WinUsb_ReadPipe(IntPtr iface, byte pipe, byte[] buf, int length, out int read, IntPtr overlapped);
    [DllImport("winusb.dll", SetLastError = true)] static extern bool WinUsb_ResetPipe(IntPtr iface, byte pipe);
    [DllImport("winusb.dll", SetLastError = true)] static extern bool WinUsb_ControlTransfer(IntPtr iface, WINUSB_SETUP_PACKET setup, byte[] buf, int length, out int transferred, IntPtr overlapped);
    [DllImport("kernel32.dll")] static extern IntPtr GetCurrentProcess();
    [DllImport("kernel32.dll")] static extern bool TerminateProcess(IntPtr process, uint code);

    static readonly Stream Out = Console.OpenStandardOutput();
    static readonly object OutLock = new object();
    static string lastStatus = "";

    static void Send(string json)
    {
        byte[] body = Encoding.UTF8.GetBytes(json);
        lock (OutLock)
        {
            Out.Write(BitConverter.GetBytes(body.Length), 0, 4);
            Out.Write(body, 0, body.Length);
            Out.Flush();
        }
    }

    static void Log(string line) { Console.Error.WriteLine("mwf-adapter: " + line); }

    static void Status(string s, string detail)
    {
        string json = "{\"s\":\"" + s + "\",\"d\":\"" + (detail ?? "").Replace("\\", "\\\\").Replace("\"", "'") + "\"}";
        if (json == lastStatus) return;
        lastStatus = json;
        Send(json);
    }

    /// <summary>Device paths of present adapters bound to WinUSB (Zadig registers an interface GUID for them).</summary>
    static string FindDevicePath(out bool plugged)
    {
        plugged = false;
        using (RegistryKey root = Registry.LocalMachine.OpenSubKey(DeviceKey))
        {
            if (root == null) return null;
            foreach (string inst in root.GetSubKeyNames())
            {
                using (RegistryKey p = root.OpenSubKey(inst + @"\Device Parameters"))
                {
                    if (p == null) continue;
                    object v = p.GetValue("DeviceInterfaceGUIDs") ?? p.GetValue("DeviceInterfaceGUID");
                    string[] guids = v as string[] ?? (v is string ? new[] { (string)v } : new string[0]);
                    foreach (string gs in guids)
                    {
                        Guid g;
                        if (!Guid.TryParse(gs, out g)) continue;
                        string path = InterfacePath(g);
                        if (path != null) return path;
                    }
                }
            }
        }
        // Present but without a WinUSB interface GUID: still on the Windows HID driver.
        plugged = IsPresent();
        return null;
    }

    static bool IsPresent()
    {
        Guid usbDevice = new Guid("A5DCBF10-6530-11D2-901F-00C04FB951ED"); // GUID_DEVINTERFACE_USB_DEVICE
        string path = null;
        IntPtr set = SetupDiGetClassDevs(ref usbDevice, IntPtr.Zero, IntPtr.Zero, DIGCF_PRESENT | DIGCF_DEVICEINTERFACE);
        try { for (int i = 0; (path = PathAt(set, usbDevice, i)) != null; i++) if (path.ToLowerInvariant().Contains("vid_057e&pid_0337")) return true; }
        finally { SetupDiDestroyDeviceInfoList(set); }
        return false;
    }

    static string InterfacePath(Guid g)
    {
        IntPtr set = SetupDiGetClassDevs(ref g, IntPtr.Zero, IntPtr.Zero, DIGCF_PRESENT | DIGCF_DEVICEINTERFACE);
        try { return PathAt(set, g, 0); }
        finally { SetupDiDestroyDeviceInfoList(set); }
    }

    static string PathAt(IntPtr set, Guid g, int index)
    {
        if (set == new IntPtr(-1)) return null;
        SP_DEVICE_INTERFACE_DATA d = new SP_DEVICE_INTERFACE_DATA();
        d.cbSize = Marshal.SizeOf(d);
        if (!SetupDiEnumDeviceInterfaces(set, IntPtr.Zero, ref g, index, ref d)) return null;
        int size;
        SetupDiGetDeviceInterfaceDetail(set, ref d, IntPtr.Zero, 0, out size, IntPtr.Zero);
        IntPtr buf = Marshal.AllocHGlobal(size);
        try
        {
            // SP_DEVICE_INTERFACE_DETAIL_DATA_W: cbSize is 8 on x64, 6 on x86; the path starts at offset 4.
            Marshal.WriteInt32(buf, IntPtr.Size == 8 ? 8 : 6);
            if (!SetupDiGetDeviceInterfaceDetail(set, ref d, buf, size, out size, IntPtr.Zero)) return null;
            return Marshal.PtrToStringUni(new IntPtr(buf.ToInt64() + 4));
        }
        finally { Marshal.FreeHGlobal(buf); }
    }

    /// <summary>Reads until the adapter goes away. Returns false if it could not be opened.</summary>
    static bool ReadAdapter(string path)
    {
        using (SafeFileHandle h = CreateFile(path, GENERIC_RW, FILE_SHARE_RW, IntPtr.Zero, OPEN_EXISTING, FILE_ATTRIBUTE_NORMAL | FILE_FLAG_OVERLAPPED, IntPtr.Zero))
        {
            if (h.IsInvalid)
            {
                int err = Marshal.GetLastWin32Error();
                if (err == ERROR_ACCESS_DENIED) Status("busy", "Another program has the adapter open (Dolphin, Slippi, melee-unlocked or Steam).");
                else Status("open-failed", "Windows error " + err + " opening the adapter.");
                return false;
            }
            IntPtr iface;
            if (!WinUsb_Initialize(h, out iface)) { Status("open-failed", "WinUSB error " + Marshal.GetLastWin32Error() + "."); return false; }
            try
            {
                // Interrupt IN/OUT endpoints; the official adapter uses 0x81 and 0x02.
                byte epIn = 0x81, epOut = 0x02;
                USB_INTERFACE_DESCRIPTOR desc;
                if (WinUsb_QueryInterfaceSettings(iface, 0, out desc))
                {
                    for (byte i = 0; i < desc.bNumEndpoints; i++)
                    {
                        WINUSB_PIPE_INFORMATION pipe;
                        if (!WinUsb_QueryPipe(iface, 0, i, out pipe) || pipe.PipeType != 3) continue; // UsbdPipeTypeInterrupt
                        if ((pipe.PipeId & 0x80) != 0) epIn = pipe.PipeId; else epOut = pipe.PipeId;
                    }
                }
                int timeout = 100;
                WinUsb_SetPipePolicy(iface, epIn, PIPE_TRANSFER_TIMEOUT, 4, ref timeout);
                WinUsb_SetPipePolicy(iface, epOut, PIPE_TRANSFER_TIMEOUT, 4, ref timeout);
                // An adapter left mid-stream (a crashed reader, or an earlier failed open) delivers nothing
                // until its pipes are reset, as melee-unlocked's gc_adapter.cpp found; a replug did the same.
                WinUsb_ResetPipe(iface, epIn);
                WinUsb_ResetPipe(iface, epOut);
                int n;
                // HID SET_PROTOCOL (report protocol), as Dolphin sends before starting: some adapters only
                // stream after it. Mayflash adapters stall it, which is harmless.
                WINUSB_SETUP_PACKET setProtocol = new WINUSB_SETUP_PACKET { RequestType = 0x21, Request = 11, Value = 1, Index = 0, Length = 0 };
                bool ctl = WinUsb_ControlTransfer(iface, setProtocol, null, 0, out n, IntPtr.Zero);
                Log("set protocol " + (ctl ? "ok" : "failed, error " + Marshal.GetLastWin32Error()));
                byte[] start = { 0x13 };
                bool wrote = WinUsb_WritePipe(iface, epOut, start, 1, out n, IntPtr.Zero);
                Log("opened: endpoints in 0x" + epIn.ToString("X2") + " out 0x" + epOut.ToString("X2") + ", start command " + (wrote ? "sent" : "failed, error " + Marshal.GetLastWin32Error()));
                // "connected" only once reports arrive; an adapter that stays silent needs a replug.
                Status("waiting", "Adapter opened, waiting for its first report.");
                bool streaming = false;
                int lastReport = Environment.TickCount;
                byte[] report = new byte[37];
                StringBuilder sb = new StringBuilder(160);
                int silent = 0, failures = 0;
                while (true)
                {
                    if (!WinUsb_ReadPipe(iface, epIn, report, report.Length, out n, IntPtr.Zero))
                    {
                        int err = Marshal.GetLastWin32Error();
                        if (err != ERROR_SEM_TIMEOUT || silent == 0) Log("read failed: error " + err);
                        if (err == ERROR_DEVICE_NOT_CONNECTED || err == ERROR_BAD_COMMAND || ++failures > 20)
                        {
                            Status("disconnected", "Windows error " + err + " reading the adapter.");
                            return true;
                        }
                        // Not streaming (timeouts) or a failed transfer: about every second, reset the read
                        // pipe and send the start command again.
                        if (err != ERROR_SEM_TIMEOUT || ++silent >= 10)
                        {
                            silent = 0;
                            WinUsb_ResetPipe(iface, epIn);
                            WinUsb_WritePipe(iface, epOut, start, 1, out n, IntPtr.Zero);
                        }
                        if (err == ERROR_SEM_TIMEOUT) failures = 0;
                        if (Environment.TickCount - lastReport > 3000)
                        {
                            streaming = false;
                            Status("silent", "The adapter is not answering. Unplug it (both cables) and plug it back in.");
                        }
                        continue;
                    }
                    silent = 0;
                    failures = 0;
                    if (n != 37 || report[0] != 0x21) continue;
                    lastReport = Environment.TickCount;
                    if (!streaming) { streaming = true; Status("connected", ""); }
                    sb.Length = 0;
                    sb.Append("{\"r\":[");
                    for (int i = 0; i < 37; i++) { if (i > 0) sb.Append(','); sb.Append(report[i]); }
                    sb.Append("]}");
                    Send(sb.ToString());
                }
            }
            finally { WinUsb_Free(iface); }
        }
    }

    public static void Run()
    {
        // Chrome closes stdin when the extension disconnects: exit then (and release the adapter).
        Thread stdin = new Thread(() =>
        {
            Stream input = Console.OpenStandardInput();
            byte[] len = new byte[4];
            try
            {
                while (true)
                {
                    if (input.Read(len, 0, 4) < 4) break;
                    int size = BitConverter.ToInt32(len, 0), got = 0;
                    byte[] skip = new byte[Math.Max(0, size)];
                    while (got < size) { int r = input.Read(skip, got, size - got); if (r <= 0) break; got += r; }
                    if (got < size) break;
                }
            }
            catch (Exception) { }
            // End at once, even with the reader blocked in a USB transfer; Windows releases the adapter.
            TerminateProcess(GetCurrentProcess(), 0);
        });
        stdin.IsBackground = true;
        stdin.Start();

        while (true)
        {
            bool plugged;
            string path = FindDevicePath(out plugged);
            if (path == null)
            {
                if (plugged) Status("no-driver", "The adapter is plugged in but not on the WinUSB driver: run Zadig (see the README).");
                else Status("not-found", "No GameCube adapter plugged in.");
                Thread.Sleep(1000);
                continue;
            }
            if (!ReadAdapter(path)) Thread.Sleep(1000);
            else Thread.Sleep(300);
        }
    }
}
