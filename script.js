const hamburger = document.getElementById('hamburger');
const navLinks = document.getElementById('nav-links');

// Mobile hamburger toggle
hamburger.addEventListener('click', () => {
  navLinks.classList.toggle('active');
});

// Fix dropdown behavior on mobile (tap to open, tap again to follow link)
document.querySelectorAll('.dropdown > a').forEach(dropdownLink => {
  dropdownLink.addEventListener('click', function (e) {
    const parentLi = this.parentElement;

    if (window.innerWidth <= 768) {

      // If dropdown is NOT open yet → open it instead of visiting the link
      if (!parentLi.classList.contains('open')) {
        e.preventDefault();
        parentLi.classList.add('open');
      }

      // If dropdown is already open → allow navigating to the link normally
      else {
        parentLi.classList.remove('open');
      }
    }
  });
});
