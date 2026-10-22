// Campfire STANDARD / EXTENDED enclosure — rev A (2026-10-22)
// Two-bay box: sealed acoustic chamber at the front, vented electronics bay behind.
// Open in OpenSCAD, set `part`, press F6 (render), then File > Export > STL.
//
// BEFORE EXPORTING: measure the driver and passive radiator with the calipers
// and set drv_cut / drv_bc / pr_cut / pr_bc below. The defaults are from the
// datasheets and may be off by a millimetre.

part = "both";            // "base" | "lid" | "both"
$fn = 96;

// ---------- Outer dimensions (mm) ----------
L    = 216;               // length (X). 216 fits a 220 mm print bed with margin
W    = 146;               // width (Y). Front face is at -Y, rear face at +Y
H    = 70;                // height, open-top base (lid is separate)
wall = 3;                 // wall and floor thickness
rad  = 6;                 // outer corner radius

chamber = 55;             // internal depth (Y) of the sealed chamber; the ND65-PR is 48 mm deep overall
div_t   = 3;              // divider wall thickness

// ---------- Front face: driver + passive radiator (MEASURE, then set) ----------
drv_cut   = 50;           // Peerless TC6FD00-04 baffle cutout: 1.97" = 50.0 mm (datasheet); overall 55 mm
drv_bc    = 52;           // its mounting-hole bolt circle — NOT on the datasheet, MEASURE hole-to-hole across
drv_screw = 3.2;          // mounting hole diameter (M3 clearance)
drv_x     = -42;          // X position from centre
pr_cut    = 52.5;         // Dayton ND65-PR baffle cutout: 2.05" = 52.1 mm (datasheet); overall 64 mm
pr_bc     = 58;           // its bolt circle — MEASURE hole-to-hole across
pr_screw  = 3.2;
pr_x      = 42;
face_z    = H / 2;        // centre height of both openings

// ---------- Rear face ----------
btn_d   = 12.7;           // 12 mm IP65 button, 1/2" hole
btn_x   = -72;
led_d   = 5.2;            // 5 mm LED
led_x   = -54;
usbc_w  = 10.5;           // panel-mount USB-C extension: slot and two screws
usbc_h  = 6;
usbc_sp = 20;             // screw spacing of the panel-mount flange
usbc_sd = 3.2;
usbc_x  = 70;
vent_w = 2; vent_h = 22; vent_pitch = 5.5; vent_n = 11; vent_z = [20, 50];

// ---------- Pi + UPS stack posts (Pi 4B pattern 58 x 49 mm, M2.5) ----------
pi_post_h    = 6;
pi_post_d    = 6.5;
pi_post_hole = 2.4;       // M2.5 self-tapping; drill 2.0 and use heat-set inserts if preferred
pi_x = 0;                 // stack position: X from centre
pi_y = 0;                 // Y offset from the bay centre

// ---------- Lid and corner posts ----------
lid_t     = 3;
post_sq   = 8;            // square corner posts
post_hole = 2.6;          // M3 self-tapping
lid_screw = 3.4;          // M3 clearance in the lid

// ---------- Divider grommet (speaker leads) ----------
grommet_d = 8; grommet_x = 80; grommet_z = 10;

// ---------- derived ----------
iL = L - 2 * wall;
iW = W - 2 * wall;
front_y = -W / 2;
rear_y  =  W / 2;
ch_y0   = -W / 2 + wall;            // chamber inner start
div_y0  = ch_y0 + chamber;          // divider spans div_y0 .. div_y0 + div_t
bay_y0  = div_y0 + div_t;
bay_y1  = W / 2 - wall;
bay_cy  = (bay_y0 + bay_y1) / 2;

echo(str("Chamber internal volume ≈ ", round(iL * chamber * (H - wall) / 1000), " cm³"));
echo(str("Electronics bay internal: ", iL, " x ", bay_y1 - bay_y0, " x ", H - wall, " mm"));

module rbox(l, w, h, r) {
  linear_extrude(h) offset(r) offset(-r) square([l, w], center = true);
}

// 2D teardrop: a circle with a 45° roof so holes in vertical walls print without support
module teardrop2d(d) {
  union() { circle(d = d); rotate(45) square(d / 2); }
}
// hole through a wall that lies in the XZ plane (axis along Y), centred at the origin
module hole_y(d, len) {
  rotate([90, 0, 0]) linear_extrude(len, center = true) teardrop2d(d);
}
module slot_y(w, h, len) { cube([w, len, h], center = true); }
module bolt_circle_y(bc, d, len) {
  for (a = [45, 135, 225, 315])
    translate([bc / 2 * cos(a), 0, bc / 2 * sin(a)]) rotate([90, 0, 0]) cylinder(d = d, h = len, center = true);
}
function post_xy(sx, sy) = [sx * (L / 2 - wall - post_sq / 2), sy * (W / 2 - wall - post_sq / 2)];

module base() {
  difference() {
    union() {
      difference() {
        rbox(L, W, H, rad);
        translate([0, 0, wall]) rbox(iL, iW, H, max(rad - wall, 1));
      }
      // divider between chamber and bay
      translate([-iL / 2, div_y0, wall - 0.01]) cube([iL, div_t, H - wall + 0.01]);
      // corner posts for the lid screws
      for (sx = [-1, 1], sy = [-1, 1]) {
        p = post_xy(sx, sy);
        translate([p[0] - post_sq / 2, p[1] - post_sq / 2, wall - 0.01]) cube([post_sq, post_sq, H - wall + 0.01]);
      }
      // Pi / UPS stack posts on the bay floor
      for (dx = [-29, 29], dy = [-24.5, 24.5])
        translate([pi_x + dx, bay_cy + pi_y + dy, wall - 0.01]) cylinder(d = pi_post_d, h = pi_post_h + 0.01);
    }
    // corner post screw holes
    for (sx = [-1, 1], sy = [-1, 1]) {
      p = post_xy(sx, sy);
      translate([p[0], p[1], H - 14]) cylinder(d = post_hole, h = 15);
    }
    // Pi post holes
    for (dx = [-29, 29], dy = [-24.5, 24.5])
      translate([pi_x + dx, bay_cy + pi_y + dy, wall - 1]) cylinder(d = pi_post_hole, h = pi_post_h + 2);
    // front face: driver and passive radiator
    translate([drv_x, front_y + wall / 2, face_z]) { hole_y(drv_cut, wall + 2); bolt_circle_y(drv_bc, drv_screw, wall + 2); }
    translate([pr_x,  front_y + wall / 2, face_z]) { hole_y(pr_cut,  wall + 2); bolt_circle_y(pr_bc,  pr_screw,  wall + 2); }
    // rear face: button, LED, USB-C panel mount, vents
    translate([btn_x, rear_y - wall / 2, face_z]) hole_y(btn_d, wall + 2);
    translate([led_x, rear_y - wall / 2, face_z]) hole_y(led_d, wall + 2);
    translate([usbc_x, rear_y - wall / 2, face_z]) {
      slot_y(usbc_w, usbc_h, wall + 2);
      for (dx = [-1, 1]) translate([dx * usbc_sp / 2, 0, 0]) rotate([90, 0, 0]) cylinder(d = usbc_sd, h = wall + 2, center = true);
    }
    for (z = vent_z, i = [0 : vent_n - 1])
      translate([(-(vent_n - 1) / 2 + i) * vent_pitch, rear_y - wall / 2, z]) slot_y(vent_w, vent_h, wall + 2);
    // floor vents under the bay, left and right of the stack
    for (side = [-1, 1], i = [0 : 5], j = [0 : 2])
      translate([side * (60 + i * vent_pitch), bay_y0 + 14 + j * 12, wall / 2]) cube([vent_w, 8, wall + 2], center = true);
    // grommet through the divider for the speaker leads
    translate([grommet_x, div_y0 + div_t / 2, grommet_z]) rotate([90, 0, 0]) cylinder(d = grommet_d, h = div_t + 2, center = true);
  }
}

module lid() {
  difference() {
    rbox(L, W, lid_t, rad);
    for (sx = [-1, 1], sy = [-1, 1]) {
      p = post_xy(sx, sy);
      translate([p[0], p[1], -1]) cylinder(d = lid_screw, h = lid_t + 2);
      translate([p[0], p[1], lid_t - 1.2]) cylinder(d1 = lid_screw, d2 = 6.5, h = 1.21);   // countersink
    }
  }
}

if (part == "base" || part == "both") base();
if (part == "lid"  || part == "both") translate([0, W + 20, 0]) lid();
