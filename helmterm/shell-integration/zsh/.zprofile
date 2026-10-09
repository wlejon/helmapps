# helmterm: the user's .zprofile, from their real ZDOTDIR (see .zshenv).
ZDOTDIR=$__helmterm_user_zdotdir
[[ -r $ZDOTDIR/.zprofile ]] && source $ZDOTDIR/.zprofile
__helmterm_user_zdotdir=$ZDOTDIR
ZDOTDIR=$__helmterm_zdotdir
