const canvas = document.getElementById("gameCanvas");
const ctx = canvas.getContext("2d");

const bgSky = new Image();
bgSky.src = "assets/bg_sky.png";

const bgTrees = new Image();
bgTrees.src = "assets/bg_trees.png";

const plumber = new Image();
plumber.src = "assets/plumber.png";

const disc = new Image();
disc.src = "assets/disc.png";

let plumberX = 400;
let plumberY = 500;
let discX = plumberX;
let discY = plumberY;
let discVX = 0;
let discVY = 0;
let throwing = false;

canvas.addEventListener("click", (e) => {
  if (!throwing) {
    throwing = true;
    discX = plumberX;
    discY = plumberY;
    discVX = (e.clientX - plumberX) / 20;
    discVY = (e.clientY - plumberY) / 20;
  }
});

function update() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bgSky, 0, 0, canvas.width, canvas.height);
  ctx.drawImage(bgTrees, 0, canvas.height - 200, canvas.width, 200);
  ctx.drawImage(plumber, plumberX - 16, plumberY - 32, 32, 32);

  if (throwing) {
    discX += discVX;
    discY += discVY;
    discVY += 0.3;
    ctx.drawImage(disc, discX - 8, discY - 8, 16, 16);

    if (discY > canvas.height) {
      throwing = false;
    }
  }

  requestAnimationFrame(update);
}

update();
