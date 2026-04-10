# making a mirror of wavelength/alt link
want to make a new link for yourself?

this runs on eleventy so first fork the repository

go to cloudflare pages and deploy the repository

set the command for building to npm run start

this will work fine for now, but won't update if there's new features added, so add the github action from [here](https://github.com/ajtabjs/Wavelength/blob/main/.github/workflows/upstream-sync.yml)

save it in the .github/workflows folder and name the yml file whatever, it'll refresh your mirror every 7 minutes

and thats it!