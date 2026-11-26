// 표준입력으로 받은 명령에 따라 키 입력을 보낸다.
// 명령: PASTE (Ctrl+V), TAB, ENTER, PING. 각 명령마다 "ok"를 한 줄 돌려준다.
using System;
using System.Runtime.InteropServices;

static class KeySender
{
    [StructLayout(LayoutKind.Sequential)]
    struct KEYBDINPUT { public ushort wVk; public ushort wScan; public uint dwFlags; public uint time; public IntPtr dwExtraInfo; }

    [StructLayout(LayoutKind.Sequential)]
    struct MOUSEINPUT { public int dx; public int dy; public uint mouseData; public uint dwFlags; public uint time; public IntPtr dwExtraInfo; }

    [StructLayout(LayoutKind.Explicit)]
    struct INPUTUNION { [FieldOffset(0)] public MOUSEINPUT mi; [FieldOffset(0)] public KEYBDINPUT ki; }

    [StructLayout(LayoutKind.Sequential)]
    struct INPUT { public uint type; public INPUTUNION u; }

    [DllImport("user32.dll", SetLastError = true)]
    static extern uint SendInput(uint nInputs, INPUT[] pInputs, int cbSize);

    const uint INPUT_KEYBOARD = 1;
    const uint KEYEVENTF_KEYUP = 0x0002;
    const ushort VK_CONTROL = 0x11, VK_V = 0x56, VK_TAB = 0x09, VK_RETURN = 0x0D;

    static INPUT Key(ushort vk, bool up)
    {
        var i = new INPUT { type = INPUT_KEYBOARD };
        i.u.ki = new KEYBDINPUT { wVk = vk, dwFlags = up ? KEYEVENTF_KEYUP : 0 };
        return i;
    }

    static void Send(params INPUT[] inputs)
    {
        SendInput((uint)inputs.Length, inputs, Marshal.SizeOf(typeof(INPUT)));
    }

    static void Press(ushort vk) { Send(Key(vk, false), Key(vk, true)); }

    static int Main()
    {
        Console.Out.WriteLine("ready");
        Console.Out.Flush();
        string line;
        while ((line = Console.In.ReadLine()) != null)
        {
            switch (line.Trim())
            {
                case "PASTE": Send(Key(VK_CONTROL, false), Key(VK_V, false), Key(VK_V, true), Key(VK_CONTROL, true)); break;
                case "TAB": Press(VK_TAB); break;
                case "ENTER": Press(VK_RETURN); break;
                case "PING": break;
                case "EXIT": return 0;
            }
            Console.Out.WriteLine("ok");
            Console.Out.Flush();
        }
        return 0;
    }
}
