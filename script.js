const hamburger = document.getElementById('hamburger');
const navLinks = document.getElementById('nav-links');

hamburger.addEventListener('click', () => {
  navLinks.classList.toggle('active');
});

document.querySelectorAll('.dropdown > a').forEach(dropdownLink => {
  dropdownLink.addEventListener('click', function (e) {
    const parentLi = this.parentElement;
    if (window.innerWidth <= 768) {
      e.preventDefault();
      parentLi.classList.toggle('open');
    }
  });
});
