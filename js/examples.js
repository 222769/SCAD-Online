export const EXAMPLES = [
  {
    name: 'Parametric box',
    code: `// Parametric box with lid lip – try the Customize tab!

/* [Size] */
// Inside width (mm)
width = 60; // [20:150]
// Inside depth (mm)
depth = 40; // [20:150]
// Inside height (mm)
height = 30; // [10:100]

/* [Walls] */
wall = 2; // [1:0.5:5]
corner_radius = 4; // [0:10]
lip = true;

/* [Hidden] */
$fn = 48;

module rounded(w, d, h, r) {
  if (r <= 0) cube([w, d, h]);
  else hull() for (x = [r, w - r], y = [r, d - r])
    translate([x, y, 0]) cylinder(r = r, h = h);
}

difference() {
  rounded(width + 2*wall, depth + 2*wall, height + wall, corner_radius + wall);
  translate([wall, wall, wall]) rounded(width, depth, height + 1, corner_radius);
  if (lip)
    translate([wall/2, wall/2, height + wall - 3])
      rounded(width + wall, depth + wall, 4, corner_radius + wall/2);
}
`,
  },
  {
    name: 'Gear',
    code: `// Simple spur gear
teeth = 20;        // [8:60]
module_size = 2;   // [0.5:0.25:5]
thickness = 6;     // [2:20]
bore = 5;          // [0:20]

/* [Hidden] */
$fn = 64;
pitch_r = teeth * module_size / 2;
outer_r = pitch_r + module_size;
root_r  = pitch_r - 1.25 * module_size;

linear_extrude(thickness) difference() {
  union() {
    circle(r = root_r);
    for (i = [0 : teeth - 1]) rotate(i * 360 / teeth)
      polygon([
        [root_r * cos(-360/teeth/2.6), root_r * sin(-360/teeth/2.6)],
        [outer_r * cos(-360/teeth/6),  outer_r * sin(-360/teeth/6)],
        [outer_r * cos( 360/teeth/6),  outer_r * sin( 360/teeth/6)],
        [root_r * cos( 360/teeth/2.6), root_r * sin( 360/teeth/2.6)],
      ]);
  }
  circle(d = bore);
}
`,
  },
  {
    name: 'CSG demo',
    code: `// Classic OpenSCAD CSG example
$fn = 64;

difference() {
  intersection() {
    cube(30, center = true);
    sphere(20);
  }
  for (a = [[0, 0, 0], [90, 0, 0], [0, 90, 0]])
    rotate(a) cylinder(d = 16, h = 40, center = true);
}
`,
  },
  {
    name: 'Vase',
    code: `// Twisted vase
height = 80;   // [20:200]
radius = 25;   // [10:60]
twist = 120;   // [0:360]
sides = 7;     // [3:12]
wall = 1.6;    // [0.8:0.2:4]

/* [Hidden] */
$fn = 96;

difference() {
  linear_extrude(height, twist = twist, scale = 1.3, slices = 60)
    circle(r = radius, $fn = sides);
  translate([0, 0, wall])
    linear_extrude(height, twist = twist, scale = 1.3, slices = 60)
      circle(r = radius - wall, $fn = sides);
}
`,
  },
];
