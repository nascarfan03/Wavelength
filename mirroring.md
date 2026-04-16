# making a mirror of wavelength/alt link
want to make a new link for yourself?

## cloudflare pages
this runs on eleventy so first fork the repository

go to cloudflare pages and deploy the repository

set the command for building to npm run start

there's a workflow that toggles to update your fork every 7 minutes so it'll stay up to date

and thats it!

## github pages

Go to your fork click the settings tab then pages

under "Build and deployment", select github actions

then it should work i guess, havent tried it