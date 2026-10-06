# broterm: the user's .zprofile, from their real ZDOTDIR (see .zshenv).
ZDOTDIR=$__broterm_user_zdotdir
[[ -r $ZDOTDIR/.zprofile ]] && source $ZDOTDIR/.zprofile
__broterm_user_zdotdir=$ZDOTDIR
ZDOTDIR=$__broterm_zdotdir
