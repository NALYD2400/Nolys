Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
Add-Type -ReferencedAssemblies System.Windows.Forms,System.Drawing -TypeDefinition @'
using System;
using System.Drawing;
using System.Windows.Forms;
using System.Runtime.InteropServices;
public sealed class NolysReplayFixture : Form {
    [DllImport("user32.dll")] private static extern bool SetWindowPos(IntPtr h, IntPtr after, int x,int y,int w,int hgt,uint flags);
    private readonly Timer timer;
    private int frame;
    protected override bool ShowWithoutActivation { get { return true; } }
    protected override CreateParams CreateParams { get { var p = base.CreateParams; p.ExStyle |= 0x08000000; return p; } }
    public NolysReplayFixture() {
        Text = "Nolys Replay Fixture";
        StartPosition = FormStartPosition.Manual;
        Location = new Point(64, 64);
        ClientSize = new Size(960, 540);
        ShowInTaskbar = false;
        DoubleBuffered = true;
        timer = new Timer { Interval = 33 };
        timer.Tick += (s,e) => { frame++; Invalidate(); };
        timer.Start();
    }
    protected override void OnShown(EventArgs e) { base.OnShown(e); SetWindowPos(Handle, new IntPtr(1),0,0,0,0,0x0013); }
    protected override void OnPaint(PaintEventArgs e) {
        e.Graphics.Clear(Color.SteelBlue);
        e.Graphics.FillRectangle(Brushes.Orange, (frame * 4) % 850, 180, 80, 80);
        e.Graphics.DrawString("Nolys Replay Fixture - frame " + frame, SystemFonts.DefaultFont, Brushes.White, 30, 30);
    }
}
'@
[System.Windows.Forms.Application]::Run([NolysReplayFixture]::new())
